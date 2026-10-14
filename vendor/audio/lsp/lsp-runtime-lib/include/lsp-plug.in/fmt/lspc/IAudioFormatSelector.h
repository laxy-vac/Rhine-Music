/*
 * Copyright (C) 2022 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2022 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 23 окт. 2022 г.
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

#ifndef LSP_PLUG_IN_FMT_LSPC_IAUDIOFORMATSELECTOR_H_
#define LSP_PLUG_IN_FMT_LSPC_IAUDIOFORMATSELECTOR_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/fmt/lspc/lspc.h>
#include <lsp-plug.in/mm/types.h>

namespace lsp
{
    namespace lspc
    {
        class IAudioFormatSelector
        {
            private:
                IAudioFormatSelector(const IAudioFormatSelector &);
                IAudioFormatSelector & operator = (const IAudioFormatSelector &);

            public:
                IAudioFormatSelector();
                virtual ~IAudioFormatSelector();

            public:
                /**
                 * Decide which audio format to use at output conversion depending on the input format
                 * @param out pointer to store the output format data
                 * @param in input format description
                 * @return status of operation
                 */
                virtual status_t decide(lspc::audio_format_t *out, const mm::audio_stream_t *in);
        };
    } /* namespace lspc */
} /* namespace lsp */


#endif /* LSP_PLUG_IN_FMT_LSPC_IAUDIOFORMATSELECTOR_H_ */
