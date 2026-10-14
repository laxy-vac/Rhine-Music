#include "lsp-eq-api.h"
#include "lsp-eq-catalog.h"
#include "../vendor/audio/windows-x64/include/json.hpp"

#include <lsp-plug.in/dsp/dsp.h>
#include <lsp-plug.in/dsp-units/filters/Equalizer.h>

#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <new>
#include <exception>
#include <initializer_list>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>

namespace
{
    constexpr uint32_t kMaxBands = 32;
    constexpr uint32_t kMaxFramesPerBlock = 1024;
    constexpr uint32_t kMaxJsonBytes = 1024 * 1024;
    constexpr uint32_t kMaxResponsePoints = 1024 * 1024;
    constexpr float kMsScale = 0.7071067811865475244f;

    struct BandConfig
    {
        const rhine_lsp_eq::FilterDefinition *filter;
        float frequency;
        float frequency2;
        float q;
        float gain_db;
        uint32_t slope;
        uint32_t channels;
        bool enabled;
        bool solo;
    };

    enum class Routing : uint8_t
    {
        Stereo,
        MidSide
    };

    struct ParsedConfig
    {
        lsp::dspu::equalizer_mode_t mode;
        Routing routing;
        uint32_t fft_rank;
        uint32_t bands_count;
        float preamp_db;
        float output_db;
        BandConfig bands[kMaxBands];
    };

    struct Instance
    {
        lsp::dspu::Equalizer process_eq[2];
        /* Response charts share work buffers with an Equalizer instance.
         * Keep separate, preconfigured chart instances so a UI response query
         * never races the audio callback's FFT/FIR processing state. */
        lsp::dspu::Equalizer chart_eq[2];
        uint32_t sample_rate;
        uint32_t channels;
        uint32_t latency_samples;
        Routing routing;
        float preamp_linear;
        float output_linear;
        float scalar_db;
        bool any_active[2];
        bool band_active[2][kMaxBands];
        float input[2][kMaxFramesPerBlock];
        float output[2][kMaxFramesPerBlock];
    };

    void write_error(char *destination, uint32_t capacity, const char *message)
    {
        if (destination == nullptr || capacity == 0)
            return;

        size_t i = 0;
        while ((i + 1) < capacity && message[i] != '\0')
        {
            destination[i] = message[i];
            ++i;
        }
        destination[i] = '\0';
    }

    using Json = nlohmann::json;

    bool contains_only_keys(const Json &object, std::initializer_list<const char *> allowed)
    {
        if (!object.is_object())
            return false;
        for (auto it = object.begin(); it != object.end(); ++it)
        {
            bool known = false;
            for (const char *key : allowed)
            {
                if (it.key() == key)
                {
                    known = true;
                    break;
                }
            }
            if (!known)
                return false;
        }
        return true;
    }

    bool read_number(const Json &object, const char *key, double fallback, bool required, double *value)
    {
        const auto item = object.find(key);
        if (item == object.end())
        {
            if (required)
                return false;
            *value = fallback;
            return true;
        }
        if (!item->is_number())
            return false;
        *value = item->get<double>();
        return std::isfinite(*value);
    }

    bool read_uint(const Json &object, const char *key, uint32_t fallback, bool required, uint32_t *value)
    {
        const auto item = object.find(key);
        if (item == object.end())
        {
            if (required)
                return false;
            *value = fallback;
            return true;
        }
        if (item->is_number_unsigned())
        {
            const uint64_t number = item->get<uint64_t>();
            if (number > UINT32_MAX)
                return false;
            *value = static_cast<uint32_t>(number);
            return true;
        }
        if (!item->is_number_integer())
            return false;
        const int64_t number = item->get<int64_t>();
        if (number < 0 || static_cast<uint64_t>(number) > UINT32_MAX)
            return false;
        *value = static_cast<uint32_t>(number);
        return true;
    }

    bool read_boolean(const Json &object, const char *key, bool fallback, bool required, bool *value)
    {
        const auto item = object.find(key);
        if (item == object.end())
        {
            if (required)
                return false;
            *value = fallback;
            return true;
        }
        if (!item->is_boolean())
            return false;
        *value = item->get<bool>();
        return true;
    }

    bool read_string(const Json &object, const char *key, std::string *value)
    {
        const auto item = object.find(key);
        if (item == object.end() || !item->is_string())
            return false;
        *value = item->get<std::string>();
        return true;
    }

    const rhine_lsp_eq::FilterDefinition *find_filter_id(const std::string &id)
    {
        for (size_t index = 0; index < rhine_lsp_eq::filter_catalog_size; ++index)
        {
            if (id == rhine_lsp_eq::filter_catalog[index].id)
                return &rhine_lsp_eq::filter_catalog[index];
        }
        return nullptr;
    }

    bool parse_band(const Json &value, uint32_t sample_rate, BandConfig *band)
    {
        if (!contains_only_keys(value, {
                "filter", "frequency", "frequency2", "q", "gain", "slope",
                "channels", "enabled", "solo", "locked", "color"}))
            return false;

        std::string filter_id;
        if (!read_string(value, "filter", &filter_id))
            return false;
        band->filter = find_filter_id(filter_id);
        if (band->filter == nullptr)
            return false;

        double frequency = 1000.0;
        double frequency2 = 2000.0;
        double q = 0.707;
        double gain_db = 0.0;
        bool has_frequency2 = value.contains("frequency2");
        if (!read_number(value, "frequency", 0.0, true, &frequency) ||
            !read_number(value, "q", q, false, &q) ||
            !read_number(value, "gain", gain_db, false, &gain_db) ||
            !read_uint(value, "slope", 1, false, &band->slope) ||
            !read_uint(value, "channels", 0, false, &band->channels) ||
            !read_boolean(value, "enabled", true, false, &band->enabled) ||
            !read_boolean(value, "solo", false, false, &band->solo))
            return false;

        if (has_frequency2)
        {
            if (!read_number(value, "frequency2", 0.0, true, &frequency2))
                return false;
        }
        else if (band->filter->second_frequency)
            return false;

        bool locked = false;
        if (!read_boolean(value, "locked", false, false, &locked))
            return false;
        const auto color = value.find("color");
        if (color != value.end() && (!color->is_string() || color->get<std::string>().size() > 63))
            return false;

        // Inactive bands retain their saved settings across source-rate changes.
        // Rate-specific limits are checked only for filters entering a DSP lane.
        const double maximum_frequency = 96000.0;
        const double minimum_q = std::strcmp(band->filter->family, "APO") == 0 ? 0.1 : 0.0;
        if (!(frequency >= 10.0 && frequency <= maximum_frequency) ||
            !(frequency2 >= 10.0 && frequency2 <= maximum_frequency) ||
            !(q >= minimum_q && q <= 100.0) ||
            gain_db < -36.0 || gain_db > 36.0 ||
            band->channels > 2 ||
            band->slope < 1 || band->slope > band->filter->max_slope)
            return false;

        band->frequency = static_cast<float>(frequency);
        band->frequency2 = static_cast<float>(frequency2);
        band->q = static_cast<float>(q);
        band->gain_db = static_cast<float>(gain_db);
        return true;
    }

    bool parse_config(const char *text, uint32_t sample_rate, uint32_t channels, ParsedConfig *config, const char **error_message)
    {
        if (text == nullptr)
        {
            *error_message = "LSP EQ configuration is required";
            return false;
        }

        size_t length = 0;
        while (length <= kMaxJsonBytes && text[length] != '\0')
            ++length;
        if (length == 0 || length > kMaxJsonBytes)
        {
            *error_message = "LSP EQ configuration is empty or too large";
            return false;
        }

        bool duplicate_key = false;
        std::unordered_map<int, std::unordered_set<std::string>> object_keys;
        const auto callback = [&duplicate_key, &object_keys](
            int depth, Json::parse_event_t event, Json &parsed) -> bool
        {
            if ((event == Json::parse_event_t::object_start || event == Json::parse_event_t::array_start) && depth > 32)
                throw std::invalid_argument("LSP EQ configuration nesting is too deep");
            if (event == Json::parse_event_t::object_start)
                /* Key events occur one level below their object's start depth. */
                object_keys[depth + 1].clear();
            else if (event == Json::parse_event_t::key)
            {
                const std::string key = parsed.get<std::string>();
                if (!object_keys[depth].insert(key).second)
                    duplicate_key = true;
            }
            else if (event == Json::parse_event_t::object_end)
                object_keys.erase(depth + 1);
            return true;
        };

        const Json root = Json::parse(text, text + length, callback);
        if (duplicate_key)
        {
            *error_message = "LSP EQ configuration contains a duplicate object key";
            return false;
        }
        if (!root.is_object())
        {
            *error_message = "LSP EQ configuration must be a JSON object";
            return false;
        }

        const Json *settings = &root;
        const auto eq = root.find("eq");
        if (eq != root.end())
        {
            if (!contains_only_keys(root, {"eq"}) ||
                !contains_only_keys(*eq, {"lsp"}))
            {
                *error_message = "LSP EQ wrapper contains an unknown field";
                return false;
            }
            const auto lsp = eq->find("lsp");
            if (lsp == eq->end() || !lsp->is_object())
            {
                *error_message = "LSP EQ configuration must contain an eq.lsp object";
                return false;
            }
            settings = &(*lsp);
        }

        if (!contains_only_keys(*settings, {"algorithm", "fftRank", "routing", "preamp", "output", "bands"}))
        {
            *error_message = "LSP EQ configuration contains an unknown field";
            return false;
        }

        std::string algorithm;
        std::string routing;
        if (!read_string(*settings, "algorithm", &algorithm))
        {
            *error_message = "LSP EQ algorithm must be a string";
            return false;
        }
        if (algorithm == "iir")
            config->mode = lsp::dspu::EQM_IIR;
        else if (algorithm == "fir")
            config->mode = lsp::dspu::EQM_FIR;
        else if (algorithm == "fft")
            config->mode = lsp::dspu::EQM_FFT;
        else if (algorithm == "spm")
            config->mode = lsp::dspu::EQM_SPM;
        else
        {
            *error_message = "LSP EQ algorithm must be iir, fir, fft, or spm";
            return false;
        }

        const auto routing_item = settings->find("routing");
        if (routing_item == settings->end())
            routing = "stereo";
        else if (!routing_item->is_string())
        {
            *error_message = "LSP EQ routing must be a string";
            return false;
        }
        else
            routing = routing_item->get<std::string>();

        if (routing == "stereo")
            config->routing = Routing::Stereo;
        else if (routing == "ms")
            config->routing = Routing::MidSide;
        else
        {
            *error_message = "LSP EQ routing must be stereo or ms";
            return false;
        }
        if (config->routing == Routing::MidSide && channels != 2)
        {
            *error_message = "LSP EQ M/S routing requires stereo input";
            return false;
        }

        uint32_t fft_rank = 12;
        double preamp_db = 0.0;
        double output_db = 0.0;
        if (!read_uint(*settings, "fftRank", 12, false, &fft_rank) || fft_rank < 10 || fft_rank > 15 ||
            !read_number(*settings, "preamp", 0.0, false, &preamp_db) ||
            !read_number(*settings, "output", 0.0, false, &output_db) ||
            preamp_db < -36.0 || preamp_db > 36.0 ||
            output_db < -36.0 || output_db > 36.0)
        {
            *error_message = "LSP EQ FFT rank or level is outside its supported range";
            return false;
        }
        config->fft_rank = fft_rank;
        config->preamp_db = static_cast<float>(preamp_db);
        config->output_db = static_cast<float>(output_db);

        const auto bands = settings->find("bands");
        if (bands == settings->end() || !bands->is_array())
        {
            *error_message = "LSP EQ bands must be an array";
            return false;
        }
        config->bands_count = static_cast<uint32_t>(bands->size());
        if (config->bands_count > kMaxBands)
        {
            *error_message = "LSP EQ supports at most 32 bands";
            return false;
        }

        for (uint32_t index = 0; index < config->bands_count; ++index)
        {
            if (!parse_band((*bands)[index], sample_rate, &config->bands[index]))
            {
                *error_message = "LSP EQ band has an invalid filter or parameter";
                return false;
            }
            if (channels == 1 && config->routing == Routing::Stereo && config->bands[index].enabled && config->bands[index].channels == 2)
            {
                *error_message = "Mono LSP EQ cannot target a right-only band";
                return false;
            }
        }

        *error_message = nullptr;
        return true;
    }
    float db_to_linear(float db)
    {
        return static_cast<float>(std::pow(10.0, static_cast<double>(db) / 20.0));
    }

    bool band_targets_channel(const BandConfig &band, uint32_t channel)
    {
        if (band.channels == 0)
            return true;
        return band.channels == (1U << channel);
    }

    bool configure_equalizer(
        lsp::dspu::Equalizer *eq,
        const ParsedConfig &config,
        uint32_t sample_rate,
        uint32_t channel,
        uint32_t *latency,
        bool *active_bands)
    {
        const size_t fir_rank = (config.mode == lsp::dspu::EQM_IIR) ? 0 : config.fft_rank;
        if (!eq->init(kMaxBands, fir_rank))
            return false;
        eq->set_sample_rate(sample_rate);
        eq->set_actual_sample_rate(sample_rate);
        eq->set_mode(config.mode);

        bool has_solo = false;
        for (uint32_t index = 0; index < kMaxBands; ++index)
            active_bands[index] = false;
        for (uint32_t index = 0; index < config.bands_count; ++index)
        {
            const BandConfig &band = config.bands[index];
            if (band.enabled && band.solo)
                has_solo = true;
        }

        for (uint32_t index = 0; index < kMaxBands; ++index)
        {
            lsp::dspu::filter_params_t params{};
            params.nType = lsp::dspu::FLT_NONE;
            params.nSlope = 1;
            params.fFreq = 1000.0f;
            params.fFreq2 = 2000.0f;
            params.fGain = 1.0f;
            params.fQuality = 0.707f;

            if (index < config.bands_count)
            {
                const BandConfig &band = config.bands[index];
                const bool enabled = band.enabled && band_targets_channel(band, channel) && (!has_solo || band.solo);
                if (enabled)
                {
                    const float maximum = 0.49f * static_cast<float>(sample_rate);
                    if (band.frequency > maximum || (band.filter->second_frequency && band.frequency2 > maximum))
                        throw std::invalid_argument("LSP active filter frequency exceeds 49% of the source sample rate");
                    active_bands[index] = true;
                    params.nType = band.filter->type;
                    params.nSlope = band.slope;
                    params.fFreq = band.frequency;
                    params.fFreq2 = band.frequency2;
                    params.fQuality = band.q;
                    params.fGain = band.filter->gain ? db_to_linear(band.gain_db) : 1.0f;
                }
            }

            if (!eq->set_params(index, &params))
                return false;
        }

        const size_t actual_latency = eq->get_latency();
        if (actual_latency > UINT32_MAX)
            return false;
        *latency = static_cast<uint32_t>(actual_latency);
        return true;
    }

    bool initialize_instance(Instance *instance, const ParsedConfig &config, uint32_t sample_rate, uint32_t channels)
    {
        lsp::dsp::init();
        instance->sample_rate = sample_rate;
        instance->channels = channels;
        instance->routing = config.routing;
        instance->preamp_linear = db_to_linear(config.preamp_db);
        instance->output_linear = db_to_linear(config.output_db);
        instance->scalar_db = config.preamp_db + config.output_db;
        instance->latency_samples = 0;
        instance->any_active[0] = false;
        instance->any_active[1] = false;
        for (uint32_t channel = 0; channel < 2; ++channel)
            for (uint32_t index = 0; index < kMaxBands; ++index)
                instance->band_active[channel][index] = false;

        for (uint32_t channel = 0; channel < channels; ++channel)
        {
            uint32_t process_latency = 0;
            uint32_t chart_latency = 0;
            bool chart_bands[kMaxBands];
            if (!configure_equalizer(&instance->process_eq[channel], config, sample_rate, channel, &process_latency, instance->band_active[channel]) ||
                !configure_equalizer(&instance->chart_eq[channel], config, sample_rate, channel, &chart_latency, chart_bands))
                return false;
            if (process_latency != chart_latency)
                return false;
            for (uint32_t index = 0; index < kMaxBands; ++index)
            {
                if (instance->band_active[channel][index] != chart_bands[index])
                    return false;
                instance->any_active[channel] = instance->any_active[channel] || instance->band_active[channel][index];
            }
            if (process_latency > instance->latency_samples)
                instance->latency_samples = process_latency;
        }
        return true;
    }
}

extern "C"
{
    uint32_t RHINE_LSP_EQ_CALL rhine_lsp_eq_version(void)
    {
        return 1;
    }

    void *RHINE_LSP_EQ_CALL rhine_lsp_eq_create(
        const char *config_json,
        uint32_t sample_rate,
        uint32_t channels,
        char *error,
        uint32_t error_capacity)
    {
        write_error(error, error_capacity, "");
        Instance *instance = nullptr;
        try
        {
            if (sample_rate < 8000 || sample_rate > 768000)
            {
                write_error(error, error_capacity, "LSP EQ sample rate must be between 8000 and 768000 Hz");
                return nullptr;
            }
            if (channels != 1 && channels != 2)
            {
                write_error(error, error_capacity, "LSP EQ channel count must be mono or stereo");
                return nullptr;
            }

            ParsedConfig config{};
            const char *parse_error = nullptr;
            if (!parse_config(config_json, sample_rate, channels, &config, &parse_error))
            {
                write_error(error, error_capacity, parse_error != nullptr ? parse_error : "Invalid LSP EQ configuration");
                return nullptr;
            }

            instance = new (std::nothrow) Instance;
            if (instance == nullptr)
            {
                write_error(error, error_capacity, "Could not allocate the LSP EQ instance");
                return nullptr;
            }
            if (!initialize_instance(instance, config, sample_rate, channels))
            {
                delete instance;
                instance = nullptr;
                write_error(error, error_capacity, "Could not initialize the LSP DSP Units Equalizer");
                return nullptr;
            }
            return instance;
        }
        catch (const std::exception &exception)
        {
            delete instance;
            write_error(error, error_capacity, exception.what());
            return nullptr;
        }
        catch (...)
        {
            delete instance;
            write_error(error, error_capacity, "LSP EQ creation failed with an unknown error");
            return nullptr;
        }
    }

    void RHINE_LSP_EQ_CALL rhine_lsp_eq_destroy(void *opaque)
    {
        delete static_cast<Instance *>(opaque);
    }

    void RHINE_LSP_EQ_CALL rhine_lsp_eq_reset(void *opaque)
    {
        Instance *instance = static_cast<Instance *>(opaque);
        if (instance == nullptr)
            return;
        for (uint32_t channel = 0; channel < instance->channels; ++channel)
        {
            instance->process_eq[channel].reset();
            instance->process_eq[channel].get_latency();
        }
    }

    int RHINE_LSP_EQ_CALL rhine_lsp_eq_process(void *opaque, double *interleaved, uint32_t frames)
    {
        Instance *instance = static_cast<Instance *>(opaque);
        if (instance == nullptr || (frames != 0 && interleaved == nullptr))
            return 1;

        uint32_t offset = 0;
        while (offset < frames)
        {
            const uint32_t block = (frames - offset < kMaxFramesPerBlock) ? (frames - offset) : kMaxFramesPerBlock;
            if (instance->channels == 1)
            {
                for (uint32_t frame = 0; frame < block; ++frame)
                    instance->input[0][frame] = static_cast<float>(interleaved[offset + frame] * instance->preamp_linear);
                instance->process_eq[0].process(instance->output[0], instance->input[0], block);
                for (uint32_t frame = 0; frame < block; ++frame)
                    interleaved[offset + frame] = static_cast<double>(instance->output[0][frame] * instance->output_linear);
            }
            else if (instance->routing == Routing::MidSide)
            {
                for (uint32_t frame = 0; frame < block; ++frame)
                {
                    const double left = interleaved[(offset + frame) * 2] * instance->preamp_linear;
                    const double right = interleaved[(offset + frame) * 2 + 1] * instance->preamp_linear;
                    instance->input[0][frame] = static_cast<float>((left + right) * kMsScale);
                    instance->input[1][frame] = static_cast<float>((left - right) * kMsScale);
                }
                instance->process_eq[0].process(instance->output[0], instance->input[0], block);
                instance->process_eq[1].process(instance->output[1], instance->input[1], block);
                for (uint32_t frame = 0; frame < block; ++frame)
                {
                    const double mid = instance->output[0][frame];
                    const double side = instance->output[1][frame];
                    interleaved[(offset + frame) * 2] = (mid + side) * kMsScale * instance->output_linear;
                    interleaved[(offset + frame) * 2 + 1] = (mid - side) * kMsScale * instance->output_linear;
                }
            }
            else
            {
                for (uint32_t channel = 0; channel < 2; ++channel)
                {
                    for (uint32_t frame = 0; frame < block; ++frame)
                    {
                        const uint32_t sample = (offset + frame) * 2 + channel;
                        instance->input[channel][frame] = static_cast<float>(interleaved[sample] * instance->preamp_linear);
                    }
                    instance->process_eq[channel].process(instance->output[channel], instance->input[channel], block);
                    for (uint32_t frame = 0; frame < block; ++frame)
                    {
                        const uint32_t sample = (offset + frame) * 2 + channel;
                        interleaved[sample] = static_cast<double>(instance->output[channel][frame] * instance->output_linear);
                    }
                }
            }
            for (uint32_t frame = 0; frame < block; ++frame)
                for (uint32_t channel = 0; channel < instance->channels; ++channel)
                    if (!std::isfinite(interleaved[(offset + frame) * instance->channels + channel]))
                        return 2;
            offset += block;
        }
        return 0;
    }

    uint32_t RHINE_LSP_EQ_CALL rhine_lsp_eq_latency(void *opaque)
    {
        const Instance *instance = static_cast<const Instance *>(opaque);
        return instance != nullptr ? instance->latency_samples : 0;
    }

    int RHINE_LSP_EQ_CALL rhine_lsp_eq_response(
        void *opaque,
        int32_t band_index,
        uint32_t channel,
        const float *frequencies,
        float *db,
        uint32_t count)
    {
        Instance *instance = static_cast<Instance *>(opaque);
        if (instance == nullptr || channel >= instance->channels || band_index < -1 || band_index >= static_cast<int32_t>(kMaxBands) ||
            count > kMaxResponsePoints || (count > 0 && (frequencies == nullptr || db == nullptr)))
            return 1;
        if (count == 0)
            return 0;

        if (band_index >= 0 && !instance->band_active[channel][band_index])
        {
            for (uint32_t i = 0; i < count; ++i)
                db[i] = 0.0f;
            return 0;
        }
        if (band_index < 0 && !instance->any_active[channel])
        {
            for (uint32_t i = 0; i < count; ++i)
                db[i] = instance->scalar_db;
            return 0;
        }

        float *real = new (std::nothrow) float[count];
        float *imaginary = new (std::nothrow) float[count];
        if (real == nullptr || imaginary == nullptr)
        {
            delete[] real;
            delete[] imaginary;
            return 2;
        }

        for (uint32_t i = 0; i < count; ++i)
        {
            if (!std::isfinite(frequencies[i]) || frequencies[i] < 0.0f)
            {
                delete[] real;
                delete[] imaginary;
                return 1;
            }
        }

        lsp::dspu::Equalizer &eq = instance->chart_eq[channel];
        if (band_index < 0)
            eq.freq_chart(real, imaginary, frequencies, count);
        else if (!eq.freq_chart(static_cast<size_t>(band_index), real, imaginary, frequencies, count))
        {
            delete[] real;
            delete[] imaginary;
            return 1;
        }

        for (uint32_t i = 0; i < count; ++i)
        {
            const double magnitude = std::hypot(static_cast<double>(real[i]), static_cast<double>(imaginary[i]));
            const double response_db = (magnitude > 1.0e-8 && std::isfinite(magnitude))
                ? 20.0 * std::log10(magnitude) + ((band_index < 0) ? instance->scalar_db : 0.0f)
                : -160.0;
            db[i] = std::isfinite(response_db)
                ? static_cast<float>(response_db)
                : -160.0f;
        }

        delete[] real;
        delete[] imaginary;
        return 0;
    }
}
