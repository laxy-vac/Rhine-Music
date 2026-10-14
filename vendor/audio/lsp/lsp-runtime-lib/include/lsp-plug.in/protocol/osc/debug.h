/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 29 мая 2019 г.
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

#ifndef LSP_PLUG_IN_PROTOCOL_OSC_DEBUG_H_
#define LSP_PLUG_IN_PROTOCOL_OSC_DEBUG_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/protocol/osc/types.h>
#include <lsp-plug.in/common/debug.h>

namespace lsp
{
    namespace osc
    {
    #ifdef LSP_TRACE
        void dump_packet(const packet_t *packet);

        void dump_packet(const void *data, size_t size);
    #else
        inline void dump_packet(const packet_t *packet) {}

        inline void dump_packet(const void *data, size_t size) {}
    #endif
    }
}


#endif /* LSP_PLUG_IN_PROTOCOL_OSC_DEBUG_H_ */
