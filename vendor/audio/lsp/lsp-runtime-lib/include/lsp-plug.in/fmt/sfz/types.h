/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 29 янв. 2023 г.
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

#ifndef LSP_PLUG_IN_FMT_SFZ_TYPES_H_
#define LSP_PLUG_IN_FMT_SFZ_TYPES_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/io/InSharedMemoryStream.h>
#include <lsp-plug.in/runtime/LSPString.h>

namespace lsp
{
    namespace sfz
    {
        /**
         * SFZ files are subdivided into sections by headers. The region header is the most essential,
         * and is the basic unit from which instruments are constructed. A group is an optional organizational
         * level containing one or more regions. The global header (one per file) contains opcodes which apply
         * to all regions in the file. The master header is an extra level added inbetween group and global for
         * the ARIA player. So, the global/group/region or global/master/group/region hierarchy contains the
         * opcodes which define which samples are played, when they are to be played, and how.
         *
         * The control header would be found at the beginning of the file and includes special opcodes for settin
         * up MIDI CC controls. The curve headers, when used, are normally found at the end of the file, and
         * define the curves used for shaping envelopes, parameter response etc.
         *
         */
        constexpr const char *HDR_REGION        = "region";     // <region>, SFZ v1
        constexpr const char *HDR_GROUP         = "group";      // <group>, SFZ v1
        constexpr const char *HDR_CONTROL       = "control";    // <control>, SFZ v2
        constexpr const char *HDR_GLOBAL        = "global";     // <global>, SFZ v2
        constexpr const char *HDR_CURVE         = "curve";      // <curve>, SFZ v2
        constexpr const char *HDR_EFFECT        = "effect";     // <effect>, SFZ v2
        constexpr const char *HDR_MASTER        = "master";     // <master>, ARIA
        constexpr const char *HDR_MIDI          = "midi";       // <midi>, ARIA
        constexpr const char *HDR_SAMPLE        = "sample";     // <sample>, Cakewalk

        enum event_type_t
        {
            EVENT_NONE,         // No event
            EVENT_COMMENT,      // Comment event
            EVENT_HEADER,       // Header event
            EVENT_OPCODE,       // Opcode event
            EVENT_INCLUDE,      // Include event
            EVENT_DEFINE,       // Define event
            EVENT_SAMPLE,       // The sample blob embedded into SFZ
        };

        /**
         * SFZ event
         */
        typedef struct event_t
        {
            event_type_t                type;       // Type of event
            LSPString                   name;       // The name of the header or the opcode
            LSPString                   value;      // The value of the opcode or text of the comment
            io::InSharedMemoryStream    blob;       // Blob data for the <sample> header
        } event_t;

    } /* namespace sfz */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_SFZ_TYPES_H_ */
