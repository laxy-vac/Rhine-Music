/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 11 июл. 2020 г.
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

#ifndef LSP_PLUG_IN_FMT_HYDROGEN_H_
#define LSP_PLUG_IN_FMT_HYDROGEN_H_

#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/io/File.h>
#include <lsp-plug.in/io/IInStream.h>
#include <lsp-plug.in/io/IInSequence.h>
#include <lsp-plug.in/lltl/parray.h>

namespace lsp
{
    namespace hydrogen
    {
        typedef struct layer_t
        {
            private:
                layer_t & operator = (const layer_t &);

            public:
                LSPString   file_name;
                float       min;
                float       max;
                float       gain;
                float       pitch;

            public:
                explicit layer_t();
                ~layer_t();
        } layer_t;

        typedef struct instrument_t
        {
            private:
                instrument_t & operator = (const instrument_t &);

            public:
                ssize_t     id;
                LSPString   file_name;
                LSPString   name;
                float       volume;
                bool        muted;
                bool        locked;
                float       pan_left;
                float       pan_right;
                float       random_pitch_factor;
                float       gain;
                bool        filter_active;
                float       filter_cutoff;
                float       filter_resonance;
                float       attack;
                float       decay;
                float       sustain;
                float       release;
                ssize_t     mute_group;
                bool        stop_note;
                ssize_t     midi_out_channel;
                ssize_t     midi_out_note;
                ssize_t     midi_in_channel;
                ssize_t     midi_in_note;
                float       fx1_level;
                float       fx2_level;
                float       fx3_level;
                float       fx4_level;

                lltl::parray<layer_t>   layers;

            public:
                explicit instrument_t();
                ~instrument_t();
        } instrument_t;

        typedef struct drumkit_t
        {
            private:
                drumkit_t & operator = (const drumkit_t &);

            public:
                LSPString           name;
                LSPString           author;
                LSPString           info;
                LSPString           license;
                lltl::parray<instrument_t> instruments;

            public:
                explicit drumkit_t();
                ~drumkit_t();

                void    swap(drumkit_t *dst);
        } drumkit_t;


        /**
         * Load drumkit file
         * @param path UTF-8 encoded location of the file
         * @param dst pointer to store drumkit data
         * @return status of operation
         */
        status_t load(const char *path, drumkit_t *dst);

        /**
         * Load drumkit file
         * @param path location of the file
         * @param dst pointer to store drumkit data
         * @return status of operation
         */
        status_t load(const LSPString *path, drumkit_t *dst);

        /**
         * Load drumkit file
         * @param path location of the file
         * @param dst pointer to store drumkit data
         * @return status of operation
         */
        status_t load(const io::Path *path, drumkit_t *dst);

        /**
         * Load drumkit from character input stream
         * @param is input stream pointer
         * @param dst pointer to store drumkit data
         * @return status of operation
         */
        status_t load(io::IInStream *is, drumkit_t *dst);

        /**
         * Load drumkit from character input stream
         * @param is input sequence pointer
         * @param dst pointer to store drumkit data
         * @return status of operation
         */
        status_t load(io::IInSequence *is, drumkit_t *dst);

    } /* namespace hydrogen */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_HYDROGEN_H_ */
