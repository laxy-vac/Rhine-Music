#pragma once

#include "../vendor/audio/windows-x64/include/json.hpp"
#include "../vendor/audio/iir1/iir/RBJ.h"
#include "lsp-eq-loader.h"
#include "lsp-clap-host.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <limits>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace rhine {

using json = nlohmann::json;

// Basic PCM effects use double coefficients/state. The separate LSP CLAP
// stage has its own Float32 boundary; widening its result does not add
// precision. Device callbacks consume prepared PCM, not these processors.
class PcmProcessor {
public:
    void configure(const json& processing, int rate, int channels,
                   const json& replayGain = json::object()) {
        if (rate <= 0) {
            throw std::invalid_argument("PCM sample rate must be positive");
        }
        if (channels <= 0) {
            throw std::invalid_argument("PCM channel count must be positive");
        }
        if (!processing.is_object()) {
            throw std::invalid_argument("processing must be a JSON object");
        }
        if (!replayGain.is_object() && !replayGain.is_null()) {
            throw std::invalid_argument("replayGain metadata must be an object or null");
        }

        const bool bitPerfect = boolValue(processing, "bitPerfect", false, "processing.bitPerfect");
        const bool requestedFloat64 = boolValue(processing, "float64", false, "processing.float64");
        std::vector<Stage> next;
        std::unique_ptr<LspPluginEq> nextLsp;
        json nextLspSettings=json::object();
        bool nextLspSelected=false,nextLspActive=false;

        const json replaySettings = objectValue(processing, "replayGain", "processing.replayGain");
        next.push_back(makeReplayGainStage(replaySettings, replayGain));

        if (processing.contains("tone")) {
            const json tone = objectValue(processing, "tone", "processing.tone");
            const bool toneEnabled = boolValue(tone, "enabled", false, "processing.tone.enabled");
            addToneStage(next, tone, "bass", "Bass tone", Iir::RBJ::LowShelf{},
                         rate, channels, toneEnabled, bitPerfect);
            addToneStage(next, tone, "treble", "Treble tone", Iir::RBJ::HighShelf{},
                         rate, channels, toneEnabled, bitPerfect);
        }

        if (processing.contains("eq")) {
            const json eq = objectValue(processing, "eq", "processing.eq");
            const bool eqEnabled = boolValue(eq, "enabled", false, "processing.eq.enabled");
            const std::string engine=stringValue(eq,"engine","standard","processing.eq.engine");
            if(engine!="standard"&&engine!="lsp")throw std::invalid_argument("processing.eq.engine must be standard or lsp");
            nextLspSelected=engine=="lsp";
            if(nextLspSelected) {
                nextLspSettings=objectValue(eq,"lsp","processing.eq.lsp");
                nextLspActive=eqEnabled&&!bitPerfect;
                if(nextLspActive)nextLsp=std::make_unique<LspPluginEq>(nextLspSettings,rate,channels);
            }
            if(!nextLspSelected) {
            const std::string mode = stringValue(eq, "mode", "graphic", "processing.eq.mode");
            if (mode != "graphic" && mode != "parametric") {
                throw std::invalid_argument("processing.eq.mode must be 'graphic' or 'parametric'");
            }
            const double preampDb = numberValueEither(eq, "preamp", "preampDb", 0.0,
                                                       "processing.eq.preamp");
            Stage preamp = makeGainStage("eq.preamp", "EQ preamp", preampDb,
                                         eqEnabled && preampDb != 0.0,
                                         eqEnabled ? "identity" : "eq-disabled");
            if (bitPerfect) deactivate(preamp, "bit-perfect");
            next.push_back(std::move(preamp));

            const double bandwidth = numberValueEither(eq, "bandwidth", "bandwidthMultiplier", 1.0,
                                                        "processing.eq.bandwidth");
            if (bandwidth < 0.5 || bandwidth > 2.0) {
                throw std::invalid_argument("processing.eq.bandwidth must be in [0.5, 2.0]");
            }
            const json bands = arrayValue(eq, "bands", "processing.eq.bands", false);
            std::vector<BandConfig> parsedBands;
            parsedBands.reserve(bands.size());
            for (std::size_t i = 0; i < bands.size(); ++i) {
                parsedBands.push_back(parseBand(bands[i], i));
            }
            const std::vector<double> allCenters = bandCenters(parsedBands);
            for (std::size_t i = 0; i < parsedBands.size(); ++i) {
                next.push_back(makeBandStage(parsedBands, allCenters, i, mode, bandwidth,
                                             rate, channels, eqEnabled, bitPerfect));
            }
            }
        }

        if (bitPerfect) {
            for (auto& stage : next) {
                deactivate(stage, "bit-perfect");
            }
        }

        stages_.swap(next);
        lsp_=std::move(nextLsp);lspSettings_=std::move(nextLspSettings);
        lspSelected_=nextLspSelected;lspActive_=nextLspActive;
        rate_ = rate;
        channels_ = channels;
        bitPerfect_ = bitPerfect;
        requestedFloat64_ = requestedFloat64;
        lastWasFloat_ = false;
        configured_ = true;
    }

    void reset() {
        if(lsp_&&lsp_->hasProcessed()) {
            // The pinned LSP CLAP wrapper's reset() is a no-op. Recreate its
            // DSP on seeks rather than retaining filter history from before
            // the seek; original GUI state is saved through CLAP state.
            const bool show=lsp_->editorOpen();
            lspSettings_["pluginState"]=lsp_->editor("state").at("pluginState");
            auto clean=std::make_unique<LspPluginEq>(lspSettings_,rate_,channels_);
            lsp_=std::move(clean);if(show)lsp_->editor("open");
        } else if(lsp_)lsp_->reset();
        for (auto& stage : stages_) {
            for (auto& filter : stage.filters) {
                filter.state.reset();
            }
        }
    }

    std::size_t inheritFilterState(const PcmProcessor& previous) {
        if (!configured_ || !previous.configured_) {
            throw std::logic_error("Both PCM processors must be configured before inheriting filter state");
        }
        if (rate_ != previous.rate_ || channels_ != previous.channels_) return 0;
        if(lspSelected_||previous.lspSelected_)return 0;

        const auto sameCoefficients = [](const Iir::Biquad& left, const Iir::Biquad& right) {
            return left.m_a0 == right.m_a0 && left.m_a1 == right.m_a1 && left.m_a2 == right.m_a2 &&
                   left.m_b0 == right.m_b0 && left.m_b1 == right.m_b1 && left.m_b2 == right.m_b2;
        };
        std::size_t copied = 0;
        for (auto& stage : stages_) {
            if (!stage.active || stage.filters.empty()) continue;
            const auto sourceStage = std::find_if(previous.stages_.begin(), previous.stages_.end(),
                [&](const Stage& candidate) {
                    return candidate.id == stage.id && candidate.filterType == stage.filterType &&
                           candidate.active && !candidate.filters.empty();
                });
            if (sourceStage == previous.stages_.end()) continue;
            for (auto& filter : stage.filters) {
                for (const auto& sourceFilter : sourceStage->filters) {
                    if (sourceFilter.channel != filter.channel ||
                        !sameCoefficients(sourceFilter.coefficients, filter.coefficients)) continue;
                    filter.state = sourceFilter.state;
                    ++copied;
                    break;
                }
            }
        }
        return copied;
    }

    void process(double* interleaved, std::size_t frames) {
        requireConfigured(interleaved, frames);
        lastWasFloat_ = false;
        if (bitPerfect_ || frames == 0) return;
        for (std::size_t frame = 0; frame < frames; ++frame) {
            double* samples = interleaved + frame * static_cast<std::size_t>(channels_);
            for (auto& stage : stages_) {
                if (!stage.active) continue;
                if (stage.isGain) {
                    for (int channel = 0; channel < channels_; ++channel) {
                        samples[channel] *= stage.gain;
                    }
                } else {
                    for (auto& filter : stage.filters) {
                        samples[filter.channel] = filter.process(samples[filter.channel]);
                    }
                }
            }
        }
        if(lsp_)lsp_->process(interleaved,frames,channels_);
    }

    void process(float* interleaved, std::size_t frames) {
        requireConfigured(interleaved, frames);
        lastWasFloat_ = true;
        if (bitPerfect_ || frames == 0) return;
        if(lsp_) {
            size_t offset=0;
            while(offset<frames) {
                const size_t count=std::min<size_t>(1024,frames-offset),samples=count*static_cast<size_t>(channels_);
                for(size_t i=0;i<samples;i++)lspFloatScratch_[i]=static_cast<double>(interleaved[offset*channels_+i]);
                process(lspFloatScratch_.data(),count);
                for(size_t i=0;i<samples;i++)interleaved[offset*channels_+i]=static_cast<float>(lspFloatScratch_[i]);
                offset+=count;
            }
            lastWasFloat_=true;return;
        }
        for (std::size_t frame = 0; frame < frames; ++frame) {
            const std::size_t offset = frame * static_cast<std::size_t>(channels_);
            for (int channel = 0; channel < channels_; ++channel) {
                double sample = static_cast<double>(interleaved[offset + static_cast<std::size_t>(channel)]);
                for (auto& stage : stages_) {
                    if (!stage.active) continue;
                    if (stage.isGain) {
                        sample *= stage.gain;
                    } else {
                        for (auto& filter : stage.filters) {
                            if (filter.channel == static_cast<std::size_t>(channel)) {
                                sample = filter.process(sample);
                            }
                        }
                    }
                }
                interleaved[offset + static_cast<std::size_t>(channel)] = static_cast<float>(sample);
            }
        }
    }

    json stages() const {
        json result = json::array();
        const char* boundary = lastWasFloat_ ? "float32" : "float64";
        for (const auto& stage : stages_) {
            json item = {
                {"id", stage.id},
                {"name", stage.name},
                {"inputPrecision", boundary},
                {"computePrecision", "float64"},
                {"outputPrecision", boundary},
                {"active", stage.active}
            };
            if (!stage.reason.empty()) item["reason"] = stage.reason;
            if (stage.hasGainDb) item["gainDb"] = stage.gainDb;
            if (stage.hasRequestedGainDb) item["requestedGainDb"] = stage.requestedGainDb;
            if (!stage.source.empty()) item["source"] = stage.source;
            if (stage.hasFrequency) item["frequencyHz"] = stage.frequencyHz;
            if (stage.hasQ) item["q"] = stage.q;
            if (stage.hasBandwidthOctaves) item["bandwidthOctaves"] = stage.bandwidthOctaves;
            if (stage.hasFilterType) item["type"] = stage.filterType;
            if (stage.hasChannelSelector) item["channels"] = stage.channelSelector;
            result.push_back(std::move(item));
        }
        if(lspSelected_) {
            result.push_back({{"id","eq.lsp"},{"name","LSP Parametric Equalizer"},{"engine","lsp"},{"active",lspActive_},
              {"inputPrecision",boundary},{"computePrecision","float32"},{"outputPrecision",boundary},
              {"latencyFrames",latencyFrames()},{"sampleRate",rate_},{"filters",json::array()},
              {"reason",bitPerfect_?"bit-perfect":lspActive_?"LSP CLAP":"eq-disabled"}});
        }
        return result;
    }
    size_t latencyFrames() const{return lsp_?lsp_->latencyFrames():0;}
    LspPluginEq* lspPlugin() const{return lsp_.get();}

    int sampleRate() const { return rate_; }
    int channels() const { return channels_; }
    bool configured() const { return configured_; }
    bool float64Enabled() const { return requestedFloat64_; }

private:
    using json = nlohmann::json;

    struct ChannelFilter {
        std::size_t channel = 0;
        Iir::Biquad coefficients;
        Iir::DirectFormII state;
        double postScale = 1.0;

        double process(double sample) {
            return coefficients.filter(sample, state) * postScale;
        }
    };

    struct Stage {
        std::string id;
        std::string name;
        std::string reason;
        std::string source;
        bool active = false;
        bool isGain = false;
        double gain = 1.0;
        double gainDb = 0.0;
        double requestedGainDb = 0.0;
        double frequencyHz = 0.0;
        double q = 0.0;
        double bandwidthOctaves = 0.0;
        int filterType = -1;
        int channelSelector = 0;
        bool hasGainDb = false;
        bool hasRequestedGainDb = false;
        bool hasFrequency = false;
        bool hasQ = false;
        bool hasBandwidthOctaves = false;
        bool hasFilterType = false;
        bool hasChannelSelector = false;
        std::vector<ChannelFilter> filters;
    };

    struct BandConfig {
        std::size_t index = 0;
        int type = -1;
        int channelSelector = 0;
        bool enabled = true;
        double frequencyHz = 0.0;
        double q = 0.0;
        double gainDb = 0.0;
    };

    void requireConfigured(const double* buffer, std::size_t frames) const {
        if (!configured_) throw std::logic_error("PcmProcessor must be configured before process()");
        if (frames != 0 && buffer == nullptr) throw std::invalid_argument("PCM buffer is null for a non-empty block");
        checkFrameCount(frames);
    }

    void requireConfigured(const float* buffer, std::size_t frames) const {
        if (!configured_) throw std::logic_error("PcmProcessor must be configured before process()");
        if (frames != 0 && buffer == nullptr) throw std::invalid_argument("PCM buffer is null for a non-empty block");
        checkFrameCount(frames);
    }

    void checkFrameCount(std::size_t frames) const {
        const auto count = static_cast<std::size_t>(channels_);
        if (frames > std::numeric_limits<std::size_t>::max() / count) {
            throw std::length_error("PCM frame count overflows the interleaved sample count");
        }
    }

    static json objectValue(const json& parent, const char* key, const std::string& label) {
        if (!parent.contains(key)) return json::object();
        if (!parent.at(key).is_object()) throw std::invalid_argument(label + " must be an object");
        return parent.at(key);
    }

    static json arrayValue(const json& parent, const char* key, const std::string& label, bool required) {
        if (!parent.contains(key)) {
            if (required) throw std::invalid_argument(label + " must be an array");
            return json::array();
        }
        if (!parent.at(key).is_array()) throw std::invalid_argument(label + " must be an array");
        return parent.at(key);
    }

    static bool boolValue(const json& object, const char* key, bool fallback, const std::string& label) {
        if (!object.contains(key)) return fallback;
        if (!object.at(key).is_boolean()) throw std::invalid_argument(label + " must be boolean");
        return object.at(key).get<bool>();
    }

    static std::string stringValue(const json& object, const char* key, const std::string& fallback,
                                   const std::string& label) {
        if (!object.contains(key)) return fallback;
        if (!object.at(key).is_string()) throw std::invalid_argument(label + " must be a string");
        return object.at(key).get<std::string>();
    }

    static double numberValue(const json& object, const char* key, double fallback,
                              const std::string& label) {
        if (!object.contains(key)) return fallback;
        const json& value = object.at(key);
        if (!value.is_number()) throw std::invalid_argument(label + " must be numeric");
        const double number = value.get<double>();
        if (!std::isfinite(number)) throw std::invalid_argument(label + " must be finite");
        return number;
    }

    static double requiredNumber(const json& object, const char* key, const std::string& label) {
        if (!object.contains(key)) throw std::invalid_argument(label + " is required");
        return numberValue(object, key, 0.0, label);
    }

    static double numberValueEither(const json& object, const char* primary, const char* alternate,
                                    double fallback, const std::string& label) {
        if (object.contains(primary) && object.contains(alternate)) {
            throw std::invalid_argument(label + " must use only one of its supported keys");
        }
        if (object.contains(primary)) return numberValue(object, primary, fallback, label);
        if (object.contains(alternate)) return numberValue(object, alternate, fallback, label);
        return fallback;
    }

    static int integerValue(const json& object, const char* key, int fallback, const std::string& label) {
        if (!object.contains(key)) return fallback;
        const json& value = object.at(key);
        if (!value.is_number_integer()) throw std::invalid_argument(label + " must be an integer");
        const auto number = value.get<long long>();
        if (number < std::numeric_limits<int>::min() || number > std::numeric_limits<int>::max()) {
            throw std::invalid_argument(label + " is outside the supported integer range");
        }
        return static_cast<int>(number);
    }

    static std::optional<double> optionalNumber(const json& object, const char* key,
                                                const std::string& label) {
        if (!object.is_object() || !object.contains(key) || object.at(key).is_null()) return std::nullopt;
        return numberValue(object, key, 0.0, label);
    }

    static double dbToLinear(double db, const std::string& label) {
        const double gain = std::pow(10.0, db / 20.0);
        if (!std::isfinite(gain) || gain == 0.0) {
            throw std::invalid_argument(label + " produces a non-finite or underflowed linear gain");
        }
        return gain;
    }

    static Stage makeGainStage(std::string id, std::string name, double gainDb,
                               bool active, std::string inactiveReason) {
        Stage stage;
        stage.id = std::move(id);
        stage.name = std::move(name);
        stage.gainDb = gainDb;
        stage.hasGainDb = true;
        stage.gain = dbToLinear(gainDb, stage.name);
        stage.isGain = true;
        stage.active = active;
        if (!active) stage.reason = std::move(inactiveReason);
        return stage;
    }

    static void deactivate(Stage& stage, const std::string& reason) {
        stage.active = false;
        stage.reason = reason;
        stage.filters.clear();
    }

    static Stage makeReplayGainStage(const json& settings, const json& tags) {
        if (!settings.is_object()) throw std::invalid_argument("processing.replayGain must be an object");
        const std::string mode = stringValue(settings, "mode", "off", "processing.replayGain.mode");
        if (mode != "off" && mode != "gain" && mode != "protect") {
            throw std::invalid_argument("processing.replayGain.mode must be 'off', 'gain', or 'protect'");
        }
        const std::string preferred = stringValue(settings, "source", "track", "processing.replayGain.source");
        if (preferred != "album" && preferred != "track") {
            throw std::invalid_argument("processing.replayGain.source must be 'album' or 'track'");
        }
        const double preamp = numberValue(settings, "preamp", 0.0, "processing.replayGain.preamp");
        const double noTagPreamp = numberValue(settings, "noTagPreamp", 0.0,
                                               "processing.replayGain.noTagPreamp");
        Stage stage;
        stage.id = "replaygain";
        stage.name = "ReplayGain";
        stage.isGain = true;
        stage.hasGainDb = true;
        stage.hasRequestedGainDb = true;
        stage.gainDb = 0.0;
        stage.requestedGainDb = 0.0;
        stage.gain = 1.0;

        if (mode == "off") {
            stage.reason = "mode-off";
            return stage;
        }

        const std::string other = preferred == "album" ? "track" : "album";
        const auto albumGain = optionalNumber(tags, "albumGainDb", "replayGain.albumGainDb");
        const auto trackGain = optionalNumber(tags, "trackGainDb", "replayGain.trackGainDb");
        const auto albumPeak = optionalNumber(tags, "albumPeak", "replayGain.albumPeak");
        const auto trackPeak = optionalNumber(tags, "trackPeak", "replayGain.trackPeak");
        for (const auto& peak : {albumPeak, trackPeak}) {
            if (peak && *peak < 0.0) throw std::invalid_argument("ReplayGain peak values must be non-negative");
        }

        const auto gainFor = [&](const std::string& source) -> std::optional<double> {
            return source == "album" ? albumGain : trackGain;
        };
        std::optional<double> tagGain = gainFor(preferred);
        std::string source;
        std::string reason;
        if (tagGain) {
            source = preferred;
        } else if (gainFor(other)) {
            source = other;
            tagGain = gainFor(other);
            reason = preferred + "-gain-missing; used-" + other;
        } else {
            stage.requestedGainDb = noTagPreamp;
            stage.gainDb = noTagPreamp;
            stage.gain = dbToLinear(stage.gainDb, "processing.replayGain.noTagPreamp");
            stage.active = stage.gainDb != 0.0;
            stage.reason = "no-valid-gain-tags; applied noTagPreamp";
            return stage;
        }

        stage.source = source;
        stage.requestedGainDb = *tagGain + preamp;
        if (!std::isfinite(stage.requestedGainDb)) {
            throw std::invalid_argument("selected ReplayGain plus preamp is not finite");
        }
        stage.gainDb = stage.requestedGainDb;
        if (mode == "protect") {
            const auto selectedPeak = source == "album" ? albumPeak : trackPeak;
            if (!selectedPeak) {
                if (!reason.empty()) reason += "; ";
                reason += "selected-source-peak-missing";
            } else if (*selectedPeak > 0.0) {
                const double ceilingDb = -20.0 * std::log10(*selectedPeak);
                if (!std::isfinite(ceilingDb)) {
                    throw std::invalid_argument("selected ReplayGain peak produces a non-finite protection ceiling");
                }
                if (stage.gainDb > ceilingDb) {
                    stage.gainDb = ceilingDb;
                    if (!reason.empty()) reason += "; ";
                    reason += "limited-to-0dBFS-peak";
                }
            } else {
                if (!reason.empty()) reason += "; ";
                reason += "selected-source-peak-is-zero";
            }
        }
        stage.gain = dbToLinear(stage.gainDb, "ReplayGain effective gain");
        stage.active = stage.gainDb != 0.0;
        if (!reason.empty()) stage.reason = reason;
        else if (!stage.active) stage.reason = "zero-effective-gain";
        return stage;
    }

    static void addToneStage(std::vector<Stage>& stages, const json& tone, const char* key,
                             const char* name, Iir::RBJ::LowShelf, int rate, int channels,
                             bool toneEnabled, bool bitPerfect) {
        addToneStageImpl(stages, tone, key, name, true, rate, channels, toneEnabled, bitPerfect);
    }

    static void addToneStage(std::vector<Stage>& stages, const json& tone, const char* key,
                             const char* name, Iir::RBJ::HighShelf, int rate, int channels,
                             bool toneEnabled, bool bitPerfect) {
        addToneStageImpl(stages, tone, key, name, false, rate, channels, toneEnabled, bitPerfect);
    }

    static void addToneStageImpl(std::vector<Stage>& stages, const json& tone, const char* key,
                                 const char* name, bool lowShelf, int rate, int channels,
                                 bool toneEnabled, bool bitPerfect) {
        const std::string label = std::string("processing.tone.") + key;
        const json band = objectValue(tone, key, label);
        const double frequency = requiredNumber(band, "frequency", label + ".frequency");
        const double q = requiredNumber(band, "q", label + ".q");
        const double gainDb = requiredNumber(band, "gain", label + ".gain");
        if (frequency <= 0.0) throw std::invalid_argument(label + ".frequency must be positive");
        if (q <= 0.0) throw std::invalid_argument(label + ".q must be greater than zero");
        if (std::abs(gainDb) > 24.0) throw std::invalid_argument(label + ".gain must be in [-24, 24] dB");

        Stage stage;
        stage.id = std::string("tone.") + key;
        stage.name = name;
        stage.gainDb = gainDb;
        stage.hasGainDb = true;
        stage.frequencyHz = frequency;
        stage.hasFrequency = true;
        stage.q = q;
        stage.hasQ = true;
        if (!toneEnabled) {
            stage.reason = "tone-disabled";
        } else if (gainDb == 0.0) {
            stage.reason = "zero-gain-identity";
        } else if (bitPerfect) {
            stage.reason = "bit-perfect";
        } else {
            validateFrequency(frequency, rate, label + ".frequency");
            ChannelFilter filter;
            filter.coefficients = makeShelfBiquad(rate, frequency, q, gainDb, lowShelf,
                                                  label + ".q/gain");
            for (int channel = 0; channel < channels; ++channel) {
                ChannelFilter perChannel;
                perChannel.channel = static_cast<std::size_t>(channel);
                perChannel.coefficients = filter.coefficients;
                stage.filters.push_back(std::move(perChannel));
            }
            stage.active = true;
        }
        if (bitPerfect) deactivate(stage, "bit-perfect");
        else if (!stage.active && stage.reason.empty()) stage.reason = "inactive";
        stages.push_back(std::move(stage));
    }

    static BandConfig parseBand(const json& value, std::size_t index) {
        const std::string label = "processing.eq.bands[" + std::to_string(index) + "]";
        if (!value.is_object()) throw std::invalid_argument(label + " must be an object");
        BandConfig band;
        band.index = index;
        band.type = integerValue(value, "type", -1, label + ".type");
        if (band.type < 0 || band.type > 5) throw std::invalid_argument(label + ".type must be in [0, 5]");
        band.channelSelector = integerValue(value, "channels", 0, label + ".channels");
        if (band.channelSelector < 0 || band.channelSelector > 2) {
            throw std::invalid_argument(label + ".channels must be 0 (both), 1 (left), or 2 (right)");
        }
        band.enabled = boolValue(value, "enabled", true, label + ".enabled");
        if (!value.contains("frequency") && !value.contains("frequencyHz")) throw std::invalid_argument(label + ".frequency is required");
        band.frequencyHz = numberValueEither(value, "frequency", "frequencyHz", 0.0, label + ".frequency");
        band.q = requiredNumber(value, "q", label + ".q");
        if (!value.contains("gain") && !value.contains("gainDb")) throw std::invalid_argument(label + ".gain is required");
        band.gainDb = numberValueEither(value, "gain", "gainDb", 0.0, label + ".gain");
        if (band.frequencyHz <= 0.0) throw std::invalid_argument(label + ".frequencyHz must be greater than zero");
        if (band.q < 0.0) throw std::invalid_argument(label + ".q must be non-negative");
        return band;
    }

    static std::vector<double> bandCenters(const std::vector<BandConfig>& bands) {
        std::vector<double> result;
        result.reserve(bands.size());
        for (const auto& band : bands) result.push_back(band.frequencyHz);
        return result;
    }

    static double graphicBandwidth(const std::vector<double>& centers, std::size_t index,
                                   double multiplier, const std::string& label) {
        if (centers.size() < 2) {
            throw std::invalid_argument(label + ".q is zero but no adjacent graphic band center is available");
        }
        std::vector<std::pair<double, std::size_t>> sorted;
        sorted.reserve(centers.size());
        for (std::size_t i = 0; i < centers.size(); ++i) sorted.emplace_back(centers[i], i);
        std::sort(sorted.begin(), sorted.end(), [](const auto& left, const auto& right) {
            return left.first < right.first;
        });
        std::size_t position = sorted.size();
        for (std::size_t i = 0; i < sorted.size(); ++i) {
            if (sorted[i].second == index) { position = i; break; }
        }
        if (position == sorted.size()) throw std::logic_error("graphic band center index was lost");
        if ((position > 0 && sorted[position - 1].first == sorted[position].first) ||
            (position + 1 < sorted.size() && sorted[position + 1].first == sorted[position].first)) {
            throw std::invalid_argument(label + " has a duplicate graphic band center; automatic bandwidth is undefined");
        }
        double width;
        if (position == 0) {
            width = std::log2(sorted[1].first / sorted[0].first);
        } else if (position + 1 == sorted.size()) {
            width = std::log2(sorted[position].first / sorted[position - 1].first);
        } else {
            width = 0.5 * std::log2(sorted[position + 1].first / sorted[position - 1].first);
        }
        width *= multiplier;
        if (!(width > 0.0) || !std::isfinite(width)) {
            throw std::invalid_argument(label + " produced an invalid automatic bandwidth");
        }
        return width;
    }

    Stage makeBandStage(const std::vector<BandConfig>& bands, const std::vector<double>& allCenters,
                        std::size_t index, const std::string& mode, double bandwidthMultiplier,
                        int rate, int channels, bool eqEnabled, bool bitPerfect) const {
        const BandConfig& band = bands[index];
        const std::string label = "processing.eq.bands[" + std::to_string(index) + "]";
        const bool automaticGraphicQ = band.type == 2 && mode == "graphic" && band.q == 0.0;
        if (band.q == 0.0 && band.enabled && eqEnabled && !automaticGraphicQ) {
            throw std::invalid_argument(label + ".q must be greater than zero (only graphic type 2 permits q=0)");
        }
        const bool peakLike = band.type == 3 || (band.type == 2 && mode == "graphic");
        const bool identity = peakLike || band.type == 4 || band.type == 5 ? band.gainDb == 0.0 : false;
        Stage stage;
        stage.id = "eq.band." + std::to_string(index);
        stage.name = bandName(band.type, band.frequencyHz, index);
        stage.filterType = band.type;
        stage.hasFilterType = true;
        stage.frequencyHz = band.frequencyHz;
        stage.hasFrequency = true;
        stage.q = band.q;
        stage.hasQ = true;
        stage.gainDb = band.gainDb;
        stage.hasGainDb = true;
        stage.channelSelector = band.channelSelector;
        stage.hasChannelSelector = true;
        if (!eqEnabled) {
            stage.reason = "eq-disabled";
        } else if (!band.enabled) {
            stage.reason = "band-disabled";
        } else if (identity) {
            stage.reason = "zero-gain-identity";
        } else if (bitPerfect) {
            stage.reason = "bit-perfect";
        } else {
            validateFrequency(band.frequencyHz, rate, label + ".frequency");
            std::vector<std::size_t> selectedChannels;
            if (band.channelSelector == 0) {
                for (int c = 0; c < channels; ++c) selectedChannels.push_back(static_cast<std::size_t>(c));
            } else {
                const std::size_t selected = static_cast<std::size_t>(band.channelSelector - 1);
                if (selected < static_cast<std::size_t>(channels)) selectedChannels.push_back(selected);
            }
            if (selectedChannels.empty()) {
                stage.reason = "selected-channel-unavailable";
            } else {
                double bandwidthOctaves = 0.0;
                if (peakLike) {
                    if (band.type == 2 && mode == "graphic" && band.q == 0.0) {
                        bandwidthOctaves = graphicBandwidth(allCenters, index, bandwidthMultiplier, label);
                    } else {
                        bandwidthOctaves = qToBandwidth(rate, band.frequencyHz, band.q, label + ".q");
                    }
                    stage.bandwidthOctaves = bandwidthOctaves;
                    stage.hasBandwidthOctaves = true;
                }
                Iir::Biquad coefficients = makeBandBiquad(band, mode, rate, bandwidthOctaves, label);
                const double postScale = (band.type == 2 && mode == "parametric")
                    ? dbToLinear(band.gainDb, label + ".gainDb") : 1.0;
                for (const std::size_t selected : selectedChannels) {
                    ChannelFilter filter;
                    filter.channel = selected;
                    filter.coefficients = coefficients;
                    filter.postScale = postScale;
                    stage.filters.push_back(std::move(filter));
                }
                stage.active = true;
            }
        }
        if (bitPerfect) deactivate(stage, "bit-perfect");
        return stage;
    }

    static Iir::Biquad makeBandBiquad(const BandConfig& band, const std::string& mode,
                                      int rate, double bandwidthOctaves, const std::string& label) {
        try {
            switch (band.type) {
            case 0: {
                Iir::RBJ::LowPass filter;
                filter.setup(static_cast<double>(rate), band.frequencyHz, band.q);
                return validateBiquad(static_cast<const Iir::Biquad&>(filter), label);
            }
            case 1: {
                Iir::RBJ::HighPass filter;
                filter.setup(static_cast<double>(rate), band.frequencyHz, band.q);
                return validateBiquad(static_cast<const Iir::Biquad&>(filter), label);
            }
            case 2:
                if (mode == "parametric") {
                    Iir::RBJ::BandPass2 filter;
                    filter.setup(static_cast<double>(rate), band.frequencyHz, band.q);
                    return validateBiquad(static_cast<const Iir::Biquad&>(filter), label);
                } else {
                    Iir::RBJ::BandShelf filter;
                    filter.setup(static_cast<double>(rate), band.frequencyHz, band.gainDb, bandwidthOctaves);
                    return validateBiquad(static_cast<const Iir::Biquad&>(filter), label);
                }
            case 3: {
                Iir::RBJ::BandShelf filter;
                filter.setup(static_cast<double>(rate), band.frequencyHz, band.gainDb, bandwidthOctaves);
                return validateBiquad(static_cast<const Iir::Biquad&>(filter), label);
            }
            case 4:
                return makeShelfBiquad(rate, band.frequencyHz, band.q, band.gainDb, true, label);
            case 5:
                return makeShelfBiquad(rate, band.frequencyHz, band.q, band.gainDb, false, label);
            default:
                throw std::invalid_argument(label + ".type is unsupported");
            }
        } catch (const std::exception& error) {
            throw std::invalid_argument(label + " RBJ coefficient setup failed: " + error.what());
        }
    }

    static Iir::Biquad makeShelfBiquad(int rate, double frequency, double q, double gainDb,
                                       bool lowShelf, const std::string& label) {
        const double A = std::pow(10.0, gainDb / 40.0);
        if (!std::isfinite(A) || A == 0.0) {
            throw std::invalid_argument(label + " gain produces invalid RBJ shelf amplitude");
        }
        const double qSquared = q * q;
        const double qTerm = (1.0 / qSquared) - 2.0;
        const double denominator = 1.0 + qTerm / (A + 1.0 / A);
        if (std::isfinite(denominator) && denominator > 1.0e-8) {
            const double slope = 1.0 / denominator;
            if (std::isfinite(slope) && slope > 0.0 && slope < 1.0e6) {
                try {
                    if (lowShelf) {
                        Iir::RBJ::LowShelf filter;
                        filter.setup(static_cast<double>(rate), frequency, gainDb, slope);
                        return validateBiquad(static_cast<const Iir::Biquad&>(filter), label);
                    }
                    Iir::RBJ::HighShelf filter;
                    filter.setup(static_cast<double>(rate), frequency, gainDb, slope);
                    return validateBiquad(static_cast<const Iir::Biquad&>(filter), label);
                } catch (const std::exception&) {
                    // The Q-form coefficients below cover valid Q values when
                    // the shelf-S conversion is ill-conditioned numerically.
                }
            }
        }

        const double w0 = 2.0 * pi() * frequency / static_cast<double>(rate);
        const double cosine = std::cos(w0);
        const double sine = std::sin(w0);
        const double alpha = sine / (2.0 * q);
        const double beta = 2.0 * std::sqrt(A) * alpha;
        double a0, a1, a2, b0, b1, b2;
        if (lowShelf) {
            b0 = A * ((A + 1.0) - (A - 1.0) * cosine + beta);
            b1 = 2.0 * A * ((A - 1.0) - (A + 1.0) * cosine);
            b2 = A * ((A + 1.0) - (A - 1.0) * cosine - beta);
            a0 = (A + 1.0) + (A - 1.0) * cosine + beta;
            a1 = -2.0 * ((A - 1.0) + (A + 1.0) * cosine);
            a2 = (A + 1.0) + (A - 1.0) * cosine - beta;
        } else {
            b0 = A * ((A + 1.0) + (A - 1.0) * cosine + beta);
            b1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cosine);
            b2 = A * ((A + 1.0) + (A - 1.0) * cosine - beta);
            a0 = (A + 1.0) - (A - 1.0) * cosine + beta;
            a1 = 2.0 * ((A - 1.0) - (A + 1.0) * cosine);
            a2 = (A + 1.0) - (A - 1.0) * cosine - beta;
        }
        for (double coefficient : {a0, a1, a2, b0, b1, b2}) {
            if (!std::isfinite(coefficient)) {
                throw std::invalid_argument(label + " Q-form shelf coefficients are not finite");
            }
        }
        Iir::Biquad result;
        try {
            result.setCoefficients(a0, a1, a2, b0, b1, b2);
        } catch (const std::exception& error) {
            throw std::invalid_argument(label + " Q-form shelf coefficient setup failed: " + error.what());
        }
        return validateBiquad(result, label);
    }

    static Iir::Biquad validateBiquad(const Iir::Biquad& coefficients, const std::string& label) {
        if (coefficients.m_a0 == 0.0) {
            throw std::invalid_argument(label + " produced a zero RBJ denominator");
        }
        for (double coefficient : {coefficients.m_a0, coefficients.m_a1, coefficients.m_a2,
                                   coefficients.m_b0, coefficients.m_b1, coefficients.m_b2}) {
            if (!std::isfinite(coefficient)) {
                throw std::invalid_argument(label + " produced non-finite RBJ coefficients");
            }
        }
        return coefficients;
    }

    static double qToBandwidth(int rate, double frequency, double q, const std::string& label) {
        if (!(q > 0.0) || !std::isfinite(q)) throw std::invalid_argument(label + " must be greater than zero");
        const double w0 = 2.0 * pi() * frequency / static_cast<double>(rate);
        const double sine = std::sin(w0);
        if (!(sine > 0.0)) throw std::invalid_argument(label + " is invalid at this frequency");
        const double bandwidth = (2.0 * sine / (std::log(2.0) * w0)) * std::asinh(1.0 / (2.0 * q));
        if (!(bandwidth > 0.0) || !std::isfinite(bandwidth)) {
            throw std::invalid_argument(label + " produces an invalid peak bandwidth");
        }
        return bandwidth;
    }

    static void validateFrequency(double frequency, int rate, const std::string& label) {
        const double nyquist = static_cast<double>(rate) / 2.0;
        if (!std::isfinite(frequency) || frequency <= 0.0) {
            throw std::invalid_argument(label + " must be finite and greater than zero");
        }
        if (frequency >= nyquist) {
            std::ostringstream message;
            message << label << " must be below Nyquist (" << nyquist << " Hz); got " << frequency;
            throw std::invalid_argument(message.str());
        }
    }

    static std::string bandName(int type, double frequency, std::size_t index) {
        static const char* labels[] = {"Low-pass", "High-pass", "Band-pass", "Peak", "Low-shelf", "High-shelf"};
        std::ostringstream name;
        name << "EQ " << labels[type] << " band " << (index + 1) << " @ " << frequency << " Hz";
        return name.str();
    }

    static double pi() { return 3.141592653589793238462643383279502884; }

    int rate_ = 0;
    int channels_ = 0;
    bool bitPerfect_ = false;
    bool requestedFloat64_ = false;
    bool lastWasFloat_ = false;
    bool configured_ = false;
    std::vector<Stage> stages_;
    std::unique_ptr<LspPluginEq> lsp_;
    json lspSettings_=json::object();
    bool lspSelected_=false,lspActive_=false;
    std::array<double,2048> lspFloatScratch_{};
};

} // namespace rhine
