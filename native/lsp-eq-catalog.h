#ifndef RHINE_LSP_EQ_CATALOG_H
#define RHINE_LSP_EQ_CATALOG_H

#include <cstddef>
#include <cstring>
#include <lsp-plug.in/dsp-units/filters/common.h>

namespace rhine_lsp_eq
{
    struct FilterDefinition
    {
        const char *id;
        lsp::dspu::filter_type_t type;
        const char *family;
        const char *shape;
        const char *design;
        bool second_frequency;
        bool gain;
        uint32_t max_slope;
    };

    /* Keep this list in sync with src/lsp-eq-catalog.mjs. These entries map
     * stable UI IDs to actual LSP DSP Units filter enum values. */
    inline constexpr FilterDefinition filter_catalog[] =
    {
        {"rlc-lowpass-bt",       lsp::dspu::FLT_BT_RLC_LOPASS,       "RLC", "lowpass",    "BT", false, false, 16},
        {"rlc-highpass-bt",      lsp::dspu::FLT_BT_RLC_HIPASS,      "RLC", "highpass",   "BT", false, false, 16},
        {"rlc-lowshelf-bt",      lsp::dspu::FLT_BT_RLC_LOSHELF,     "RLC", "lowshelf",   "BT", false, true,  16},
        {"rlc-highshelf-bt",     lsp::dspu::FLT_BT_RLC_HISHELF,     "RLC", "highshelf",  "BT", false, true,  16},
        {"rlc-bell-bt",          lsp::dspu::FLT_BT_RLC_BELL,        "RLC", "bell",       "BT", false, true,  16},
        {"rlc-resonance-bt",     lsp::dspu::FLT_BT_RLC_RESONANCE,   "RLC", "resonance",  "BT", false, true,  16},
        {"rlc-notch-bt",         lsp::dspu::FLT_BT_RLC_NOTCH,       "RLC", "notch",      "BT", false, false, 16},
        {"rlc-allpass-bt",       lsp::dspu::FLT_BT_RLC_ALLPASS,     "RLC", "allpass",    "BT", false, true,  16},
        {"rlc-allpass2-bt",      lsp::dspu::FLT_BT_RLC_ALLPASS2,    "RLC", "allpass2",   "BT", true,  true,  16},
        {"rlc-ladderpass-bt",    lsp::dspu::FLT_BT_RLC_LADDERPASS,  "RLC", "ladderpass", "BT", true, true,  16},
        {"rlc-ladderrej-bt",     lsp::dspu::FLT_BT_RLC_LADDERREJ,   "RLC", "ladderrej",  "BT", true, true,  16},
        {"rlc-bandpass-bt",      lsp::dspu::FLT_BT_RLC_BANDPASS,    "RLC", "bandpass",   "BT", true,  true,  16},
        {"rlc-lowpass-mt",       lsp::dspu::FLT_MT_RLC_LOPASS,      "RLC", "lowpass",    "MT", false, false, 16},
        {"rlc-highpass-mt",      lsp::dspu::FLT_MT_RLC_HIPASS,     "RLC", "highpass",   "MT", false, false, 16},
        {"rlc-lowshelf-mt",      lsp::dspu::FLT_MT_RLC_LOSHELF,    "RLC", "lowshelf",   "MT", false, true,  16},
        {"rlc-highshelf-mt",     lsp::dspu::FLT_MT_RLC_HISHELF,    "RLC", "highshelf",  "MT", false, true,  16},
        {"rlc-bell-mt",          lsp::dspu::FLT_MT_RLC_BELL,       "RLC", "bell",       "MT", false, true,  16},
        {"rlc-resonance-mt",     lsp::dspu::FLT_MT_RLC_RESONANCE,  "RLC", "resonance",  "MT", false, true,  16},
        {"rlc-notch-mt",         lsp::dspu::FLT_MT_RLC_NOTCH,      "RLC", "notch",      "MT", false, false, 16},
        {"rlc-allpass-mt",       lsp::dspu::FLT_MT_RLC_ALLPASS,    "RLC", "allpass",    "MT", false, true,  16},
        {"rlc-allpass2-mt",      lsp::dspu::FLT_MT_RLC_ALLPASS2,   "RLC", "allpass2",   "MT", true,  true,  16},
        {"rlc-ladderpass-mt",    lsp::dspu::FLT_MT_RLC_LADDERPASS, "RLC", "ladderpass", "MT", true, true,  16},
        {"rlc-ladderrej-mt",     lsp::dspu::FLT_MT_RLC_LADDERREJ,  "RLC", "ladderrej",  "MT", true, true,  16},
        {"rlc-bandpass-mt",      lsp::dspu::FLT_MT_RLC_BANDPASS,   "RLC", "bandpass",   "MT", true,  true,  16},

        {"bwc-lowpass-bt",       lsp::dspu::FLT_BT_BWC_LOPASS,      "BWC", "lowpass",    "BT", false, false, 16},
        {"bwc-highpass-bt",      lsp::dspu::FLT_BT_BWC_HIPASS,     "BWC", "highpass",   "BT", false, false, 16},
        {"bwc-lowshelf-bt",      lsp::dspu::FLT_BT_BWC_LOSHELF,    "BWC", "lowshelf",   "BT", false, true,  16},
        {"bwc-highshelf-bt",     lsp::dspu::FLT_BT_BWC_HISHELF,    "BWC", "highshelf",  "BT", false, true,  16},
        {"bwc-bell-bt",          lsp::dspu::FLT_BT_BWC_BELL,       "BWC", "bell",       "BT", false, true,  16},
        {"bwc-ladderpass-bt",    lsp::dspu::FLT_BT_BWC_LADDERPASS, "BWC", "ladderpass", "BT", true, true,  16},
        {"bwc-ladderrej-bt",     lsp::dspu::FLT_BT_BWC_LADDERREJ,  "BWC", "ladderrej",  "BT", true, true,  16},
        {"bwc-bandpass-bt",      lsp::dspu::FLT_BT_BWC_BANDPASS,   "BWC", "bandpass",   "BT", true,  true,  16},
        {"bwc-allpass-bt",       lsp::dspu::FLT_BT_BWC_ALLPASS,    "BWC", "allpass",    "BT", false, true,  16},
        {"bwc-lowpass-mt",       lsp::dspu::FLT_MT_BWC_LOPASS,     "BWC", "lowpass",    "MT", false, false, 16},
        {"bwc-highpass-mt",      lsp::dspu::FLT_MT_BWC_HIPASS,    "BWC", "highpass",   "MT", false, false, 16},
        {"bwc-lowshelf-mt",      lsp::dspu::FLT_MT_BWC_LOSHELF,   "BWC", "lowshelf",   "MT", false, true,  16},
        {"bwc-highshelf-mt",     lsp::dspu::FLT_MT_BWC_HISHELF,   "BWC", "highshelf",  "MT", false, true,  16},
        {"bwc-bell-mt",          lsp::dspu::FLT_MT_BWC_BELL,      "BWC", "bell",       "MT", false, true,  16},
        {"bwc-ladderpass-mt",    lsp::dspu::FLT_MT_BWC_LADDERPASS,"BWC", "ladderpass", "MT", true, true,  16},
        {"bwc-ladderrej-mt",     lsp::dspu::FLT_MT_BWC_LADDERREJ, "BWC", "ladderrej",  "MT", true, true,  16},
        {"bwc-bandpass-mt",      lsp::dspu::FLT_MT_BWC_BANDPASS,  "BWC", "bandpass",   "MT", true,  true,  16},
        {"bwc-allpass-mt",       lsp::dspu::FLT_MT_BWC_ALLPASS,   "BWC", "allpass",    "MT", false, true,  16},

        {"lrx-lowpass-bt",       lsp::dspu::FLT_BT_LRX_LOPASS,      "LRX", "lowpass",    "BT", false, false, 16},
        {"lrx-highpass-bt",      lsp::dspu::FLT_BT_LRX_HIPASS,     "LRX", "highpass",   "BT", false, false, 16},
        {"lrx-lowshelf-bt",      lsp::dspu::FLT_BT_LRX_LOSHELF,    "LRX", "lowshelf",   "BT", false, true,  16},
        {"lrx-highshelf-bt",     lsp::dspu::FLT_BT_LRX_HISHELF,    "LRX", "highshelf",  "BT", false, true,  16},
        {"lrx-bell-bt",          lsp::dspu::FLT_BT_LRX_BELL,       "LRX", "bell",       "BT", false, true,  16},
        {"lrx-ladderpass-bt",    lsp::dspu::FLT_BT_LRX_LADDERPASS, "LRX", "ladderpass", "BT", true, true,  16},
        {"lrx-ladderrej-bt",     lsp::dspu::FLT_BT_LRX_LADDERREJ,  "LRX", "ladderrej",  "BT", true, true,  16},
        {"lrx-bandpass-bt",      lsp::dspu::FLT_BT_LRX_BANDPASS,   "LRX", "bandpass",   "BT", true,  true,  16},
        {"lrx-allpass-bt",       lsp::dspu::FLT_BT_LRX_ALLPASS,    "LRX", "allpass",    "BT", false, true,  16},
        {"lrx-lowpass-mt",       lsp::dspu::FLT_MT_LRX_LOPASS,     "LRX", "lowpass",    "MT", false, false, 16},
        {"lrx-highpass-mt",      lsp::dspu::FLT_MT_LRX_HIPASS,    "LRX", "highpass",   "MT", false, false, 16},
        {"lrx-lowshelf-mt",      lsp::dspu::FLT_MT_LRX_LOSHELF,   "LRX", "lowshelf",   "MT", false, true,  16},
        {"lrx-highshelf-mt",     lsp::dspu::FLT_MT_LRX_HISHELF,   "LRX", "highshelf",  "MT", false, true,  16},
        {"lrx-bell-mt",          lsp::dspu::FLT_MT_LRX_BELL,      "LRX", "bell",       "MT", false, true,  16},
        {"lrx-ladderpass-mt",    lsp::dspu::FLT_MT_LRX_LADDERPASS,"LRX", "ladderpass", "MT", true, true,  16},
        {"lrx-ladderrej-mt",     lsp::dspu::FLT_MT_LRX_LADDERREJ, "LRX", "ladderrej",  "MT", true, true,  16},
        {"lrx-bandpass-mt",      lsp::dspu::FLT_MT_LRX_BANDPASS,  "LRX", "bandpass",   "MT", true,  true,  16},
        {"lrx-allpass-mt",       lsp::dspu::FLT_MT_LRX_ALLPASS,   "LRX", "allpass",    "MT", false, true,  16},

        {"apo-lowpass-dr",       lsp::dspu::FLT_DR_APO_LOPASS,     "APO", "lowpass",    "DR", false, false, 1},
        {"apo-highpass-dr",      lsp::dspu::FLT_DR_APO_HIPASS,    "APO", "highpass",   "DR", false, false, 1},
        {"apo-bandpass-dr",      lsp::dspu::FLT_DR_APO_BANDPASS,  "APO", "bandpass",   "DR", false, true,  1},
        {"apo-notch-dr",         lsp::dspu::FLT_DR_APO_NOTCH,     "APO", "notch",      "DR", false, false, 1},
        {"apo-allpass-dr",       lsp::dspu::FLT_DR_APO_ALLPASS,   "APO", "allpass",    "DR", false, false,  1},
        {"apo-allpass2-dr",      lsp::dspu::FLT_DR_APO_ALLPASS2,  "APO", "allpass2",   "DR", true,  false,  1},
        {"apo-peaking-dr",       lsp::dspu::FLT_DR_APO_PEAKING,   "APO", "peaking",    "DR", false, true,  1},
        {"apo-lowshelf-dr",      lsp::dspu::FLT_DR_APO_LOSHELF,   "APO", "lowshelf",   "DR", false, true,  1},
        {"apo-highshelf-dr",     lsp::dspu::FLT_DR_APO_HISHELF,   "APO", "highshelf",  "DR", false, true,  1},
        {"apo-ladderpass-dr",    lsp::dspu::FLT_DR_APO_LADDERPASS,"APO", "ladderpass", "DR", true, true,  1},
        {"apo-ladderrej-dr",     lsp::dspu::FLT_DR_APO_LADDERREJ, "APO", "ladderrej",  "DR", true, true,  1},
    };

    inline constexpr size_t filter_catalog_size = sizeof(filter_catalog) / sizeof(filter_catalog[0]);

    inline const FilterDefinition *find_filter(const char *id)
    {
        if (id == nullptr)
            return nullptr;
        for (size_t i = 0; i < filter_catalog_size; ++i)
        {
            if (std::strcmp(id, filter_catalog[i].id) == 0)
                return &filter_catalog[i];
        }
        return nullptr;
    }
}

#endif /* RHINE_LSP_EQ_CATALOG_H */
