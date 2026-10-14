/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 6 сент. 2019 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_FMT_ROOMEQWIZARD_H_
#define LSP_PLUG_IN_FMT_ROOMEQWIZARD_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/io/File.h>
#include <lsp-plug.in/io/IInStream.h>

namespace lsp
{
    namespace room_ew
    {
        enum filter_type_t
        {
            NONE,
            PK,     // peaking (parametric) filter
            MODAL,  // Modal filter
            LP,     // 12dB/octave Low Pass filter (Q=0.7071)
            HP,     // 12dB/octave High Pass filter (Q=0.7071)
            LPQ,    // 12dB/octave Low Pass filter with adjustable Q
            HPQ,    // 12dB/octave High Pass filter with adjustable Q
            LS,     // Low Shelf filter
            LSC,    // Low Shelf filter (variation)
            HS,     // High Shelf filter
            HSC,    // High Shelf filter (variation)
            LS6,    // 6dB/octave Low Shelf filter
            HS6,    // 6dB/octave High Shelf filter
            LS12,   // 12dB/octave Low Shelf filter
            HS12,   // 12dB/octave High Shelf filter
            NO,     // notch filter
            AP,     // allpass filter
            BP,     // bandpass filter
        };

        typedef struct filter_t
        {
            double          Q;
            double          fc;
            double          gain;
            filter_type_t   filterType;
            bool            enabled;

// Other parameters will be used some times... maybe
//            double          A;
//            double          a[3];
//            double          aC[3];
//            double          aSum;
//            double          alpha;
//            double          b[3];
//            double          bC[3];
//            double          bSum;
//            double          betasn;
//            int32_t         control;
//            double          cs;
//            double          freqNorm;
//            double          omega;
//            float           optMaxFreq;
//            float           optMinFreq;
//            double          p[5];
//            double          sTh[2];
//            double          sampleRate;
//            double          sn;
//            double          t60Target;
//            int32_t         type;
        } filter_t;

        typedef struct config_t
        {
            int32_t         nVerMaj;        // Major version
            int32_t         nVerMin;        // Minor version
            const char     *sEqType;        // Equalizer type
            const char     *sNotes;         // Notes
            double          fPreamp;        // Pre-amplification gain in dB
            size_t          nFilters;       // Number of filters
            filter_t       *vFilters;       // List of filters
        } config_t;

        /**
         * Load configuration file
         * @param path UTF-8 encoded location of the file
         * @param dst pointer to store configuration,
         *   configuration should be free()'d after use
         * @return status of operation
         */
        status_t load(const char *path, config_t **dst);

        /**
         * Load configuration file
         * @param path location of the file
         * @param dst pointer to store configuration,
         *   configuration should be free()'d after use
         * @return status of operation
         */
        status_t load(const LSPString *path, config_t **dst);

        /**
         * Load configuration file
         * @param path location of the file
         * @param dst pointer to store configuration,
         *   configuration should be free()'d after use
         * @return status of operation
         */
        status_t load(const io::Path *path, config_t **dst);

        /**
         * Load configuration from file
         * @param fd file handle
         * @param dst pointer to store configuration,
         *   configuration should be free()'d after use
         * @return status of operation
         */
        status_t load(FILE *fd, config_t **dst);

        /**
         * Load configuration from character input stream
         * @param is input stream pointer
         * @param dst pointer to store configuration,
         *   configuration should be free()'d after use
         * @return status of operation
         */
        status_t load(io::IInStream *is, config_t **dst);

        /**
         * Load configuration from file
         * @param fd input file pointer
         * @param dst pointer to store configuration,
         *   configuration should be free()'d after use
         * @return status of operation
         */
        status_t load(io::File *fd, config_t **dst);

        /**
         * Load configuration from data chunk
         * @param data buffer with data
         * @param size size of buffer
         * @param dst pointer to store configuration,
         *   configuration should be free()'d after use
         * @return status of operation
         */
        status_t load(const void *data, size_t size, config_t **dst);

    } /* namespace room_ew */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_ROOMEQWIZARD_H_ */
