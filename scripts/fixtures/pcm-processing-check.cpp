#include "../../native/pcm-processing.h"
#include "../../native/pcm-resampler.h"
#include "../../native/pcm-engine.h"

#include <cmath>
#include <cstddef>
#include <iostream>
#include <stdexcept>
#include <vector>

using rhine::json;

static void require(bool condition, const char* message) {
    if (!condition) throw std::runtime_error(message);
}

int main() {
    const json processing = {
        {"float64", true},
        {"replayGain", {{"mode", "protect"}, {"source", "album"},
                         {"preamp", 20.0}, {"noTagPreamp", -3.0}}},
        {"tone", {{"enabled", true},
                   {"bass", {{"frequency", 100.0}, {"q", 0.707}, {"gain", 2.0}}},
                   {"treble", {{"frequency", 6000.0}, {"q", 0.707}, {"gain", -1.0}}}}},
        {"eq", {{"enabled", true}, {"mode", "graphic"}, {"preamp", -1.0}, {"bandwidth", 1.0},
                 {"bands", json::array({
                     {{"type", 2}, {"channels", 0}, {"frequencyHz", 1000.0}, {"q", 0.0}, {"gainDb", 6.0}, {"enabled", true}},
                     {{"type", 0}, {"channels", 0}, {"frequencyHz", 80.0}, {"q", 0.707}, {"gainDb", 0.0}, {"enabled", true}},
                     {{"type", 4}, {"channels", 1}, {"frequencyHz", 150.0}, {"q", 0.707}, {"gainDb", 3.0}, {"enabled", true}},
                     {{"type", 5}, {"channels", 2}, {"frequencyHz", 8000.0}, {"q", 10.0}, {"gainDb", 2.0}, {"enabled", true}}
                 })}}}
    };
    const json tags = {{"trackGainDb", -8.0}, {"trackPeak", 0.9},
                       {"albumGainDb", 0.0}, {"albumPeak", 0.5}};

    rhine::PcmProcessor processor;
    processor.configure(processing, 48000, 2, tags);
    std::vector<double> block(2048, 0.0);
    block[0] = 0.5;
    processor.process(block.data(), block.size() / 2);
    for (double sample : block) require(std::isfinite(sample), "double DSP produced a non-finite sample");
    json stages = processor.stages();
    require(stages.is_array() && stages.size() >= 8, "stage list is incomplete");
    require(stages[0]["gainDb"].get<double>() < 7.0, "peak protection did not limit ReplayGain");
    require(stages[0]["reason"].get<std::string>().find("limited-to-0dBFS-peak") != std::string::npos,
            "ReplayGain stage did not explain peak protection");
    require(stages[0]["computePrecision"] == "float64", "double DSP precision was not reported");
    require(stages[5]["active"].get<bool>(), "0 dB low-pass was incorrectly treated as identity");

    processor.reset();
    std::vector<float> floatBlock(512, 0.0f);
    floatBlock[0] = 0.25f;
    processor.process(floatBlock.data(), floatBlock.size() / 2);
    stages = processor.stages();
    require(stages[0]["inputPrecision"] == "float32" && stages[0]["outputPrecision"] == "float32" &&
            stages[0]["computePrecision"] == "float64", "float path precision was misreported");

    bool rejectedNyquist = false;
    try {
        rhine::PcmProcessor invalid;
        invalid.configure({{"eq", {{"enabled", true}, {"mode", "parametric"},
                                    {"bands", json::array({{{"type", 0}, {"frequencyHz", 24000.0},
                                                             {"q", 0.707}, {"gainDb", 0.0}}})}}}},
                          48000, 2);
    } catch (const std::invalid_argument& error) {
        rejectedNyquist = std::string(error.what()).find("Nyquist") != std::string::npos;
    }
    require(rejectedNyquist, "frequency at Nyquist was not rejected clearly");

    rhine::PcmProcessor parametricBandpass;
    parametricBandpass.configure({{"eq", {{"enabled", true}, {"mode", "parametric"},
                                           {"bands", json::array({{{"type", 2}, {"frequencyHz", 1200.0},
                                                                    {"q", 1.0}, {"gainDb", 0.0}}})}}}},
                                  48000, 2);
    std::vector<double> bandpassBlock(256, 0.0);
    bandpassBlock[0] = 1.0;
    parametricBandpass.process(bandpassBlock.data(), bandpassBlock.size() / 2);
    require(parametricBandpass.stages()[2]["active"].get<bool>(),
            "0 dB parametric band-pass was incorrectly treated as identity");

    rhine::PcmResampler resampler;
    resampler.configure(44100, 48000, 2, 64);
    require(resampler.latencyFrames() == 0, "pinned linear-phase r8brain integer latency changed");
    require(std::isfinite(resampler.latencyFraction()), "r8brain fractional latency is not finite");
    require(resampler.inputRequired(32) > 0, "inputRequired did not report initial source demand");

    constexpr std::size_t inputFrames = 512;
    std::vector<double> input(inputFrames * 2);
    for (std::size_t frame = 0; frame < inputFrames; ++frame) {
        input[frame * 2] = std::sin(0.03 * static_cast<double>(frame));
        input[frame * 2 + 1] = std::cos(0.02 * static_cast<double>(frame));
    }
    std::vector<double> output;
    std::size_t submitted = 0;
    double outputScratch[256 * 2];
    while (submitted < inputFrames) {
        const std::size_t consumed = resampler.push(input.data() + submitted * 2, inputFrames - submitted);
        submitted += consumed;
        const std::size_t produced = resampler.pull(outputScratch, 256);
        output.insert(output.end(), outputScratch, outputScratch + produced * 2);
        require(consumed != 0 || produced != 0, "resampler push/pull made no progress");
    }
    resampler.finish();
    while (!resampler.drained()) {
        const std::size_t produced = resampler.pull(outputScratch, 256);
        output.insert(output.end(), outputScratch, outputScratch + produced * 2);
        require(produced != 0 || resampler.drained(), "resampler EOF drain stalled");
    }
    const std::size_t expectedOutputFrames = static_cast<std::size_t>(std::llround(
        static_cast<double>(inputFrames) * 48000.0 / 44100.0));
    require(output.size() / 2 == expectedOutputFrames, "resampler EOF output frame count is wrong");
    for (double sample : output) require(std::isfinite(sample), "resampler produced a non-finite sample");

    // Exercise the production wire keys, not just the older component aliases.
    const json canonical = {{"eq", {{"enabled", false}, {"mode", "graphic"},
      {"bands", json::array({{{"type", 2}, {"frequency", 16000.0}, {"q", 0.0}, {"gain", 0.0}}})}}},
      {"tone", {{"enabled", false}, {"bass", {{"frequency", 90.0}, {"q", .8}, {"gain", 0.0}}},
       {"treble", {{"frequency", 10000.0}, {"q", .6}, {"gain", 0.0}}}}}};
    rhine::PcmProcessor lowRate;lowRate.configure(canonical,8000,2);double quiet[2]={0,0};lowRate.process(quiet,1);
    rhine::PcmEngine live;live.configure(canonical,48000,48000,2);live.reserveFrames(2048);
    const auto constant=[](double* target,std::size_t capacity){std::fill(target,target+capacity*2,.1);rhine::PcmDecodedBlock block;block.frames=capacity;return block;};
    std::vector<double> liveOutput(1024);
    require(live.pullDouble(liveOutput.data(),128,constant).frames==128,"initial live processing failed");
    json changed=canonical;changed["eq"]["enabled"]=true;changed["eq"]["preamp"]=6.0;
    live.updateEffects(changed,json::object(),480);
    require(live.pullDouble(liveOutput.data(),512,constant).frames==512,"effects update lost frames");
    require(live.outputFramesRead()==640&&live.sourceFramesRead()==640,"effects update reset the timeline");
    require(liveOutput.front()>.1&&liveOutput.front()<.15,"effects update introduced an abrupt gain step");
    require(std::abs(liveOutput.back()-.1*std::pow(10.0,6.0/20.0))<1e-12,"effects update did not settle to the requested gain");
    require(!live.effectsTransitionActive(),"effects transition did not finish");live.collectRetiredEffects();
    const json continuity = { {"replayGain", {{"mode", "gain"}, {"source", "track"}, {"preamp", 0.0}}},
        {"tone", {{"enabled", true}, {"bass", {{"frequency", 90.0}, {"q", .707}, {"gain", 2.0}}},
                         {"treble", {{"frequency", 6000.0}, {"q", .707}, {"gain", -1.0}}}}},
        {"eq", {{"enabled", true}, {"mode", "parametric"}, {"bands", json::array({
            {{"type", 3}, {"channels", 0}, {"frequency", 1200.0}, {"q", .707}, {"gain", 5.0}}
        })}}} };
    constexpr std::size_t continuityFrames=1024,splitFrames=377;
    std::vector<double> continuityInput(continuityFrames*2),wholeOutput(continuityFrames*2),splitOutput(continuityFrames*2);
    for(std::size_t frame=0;frame<continuityFrames;frame++)for(std::size_t channel=0;channel<2;channel++)
        continuityInput[frame*2+channel]=.3*std::sin(.071*static_cast<double>(frame))+ .1*std::cos(.023*static_cast<double>(frame)+channel);
    const json continuityTags={{"trackGainDb",-2.0}};
    const auto makeReader=[&](std::size_t& cursor){
        auto* position=&cursor;
        return rhine::PcmEngine::DoubleDecoderReadFn([&continuityInput,position](double* target,std::size_t capacity){
            rhine::PcmDecodedBlock decoded;decoded.frames=std::min(capacity,continuityFrames-*position);
            std::copy_n(continuityInput.data()+*position*2,decoded.frames*2,target);*position+=decoded.frames;
            decoded.eof=*position==continuityFrames;return decoded;
        });
    };
    rhine::PcmEngine wholeEngine,firstEngine,secondEngine;
    wholeEngine.configure(continuity,48000,48000,2,continuityTags);
    firstEngine.configure(continuity,48000,48000,2,continuityTags);
    secondEngine.configure(continuity,48000,48000,2,continuityTags);
    std::size_t wholeCursor=0,firstCursor=0,secondCursor=splitFrames;
    require(wholeEngine.pullDouble(wholeOutput.data(),continuityFrames,makeReader(wholeCursor)).frames==continuityFrames,
            "whole-track filter-state reference render failed");
    require(firstEngine.pullDouble(splitOutput.data(),splitFrames,makeReader(firstCursor)).frames==splitFrames,
            "first split-track filter-state render failed");
    require(secondEngine.inheritFilterState(firstEngine)>0,"gapless handoff did not inherit any matching IIR states");
    require(secondEngine.pullDouble(splitOutput.data()+splitFrames*2,continuityFrames-splitFrames,makeReader(secondCursor)).frames==continuityFrames-splitFrames,
            "second split-track filter-state render failed");
    require(splitOutput==wholeOutput,"gapless filter-state inheritance changed the continuous PCM render");
    rhine::PcmProcessor replaySource,replayTarget;json replaySettings=continuity;replaySettings["replayGain"]["mode"]="gain";
    replaySource.configure(replaySettings,48000,2,{{"trackGainDb",-2.0}});
    replayTarget.configure(replaySettings,48000,2,{{"trackGainDb",-6.0}});
    replayTarget.inheritFilterState(replaySource);
    require(replayTarget.stages()[0]["gainDb"].get<double>()==-6.0,"filter-state inheritance copied the previous track's ReplayGain stage");
    std::cout << "offline PCM smoke passed; outputFrames=" << output.size() / 2 << "; hot effects retained 640 frames\n";
    return 0;
}
