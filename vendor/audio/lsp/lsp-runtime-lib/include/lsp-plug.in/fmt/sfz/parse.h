/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 2 мар. 2023 г.
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

#ifndef LSP_PLUG_IN_FMT_SFZ_PARSE_H_
#define LSP_PLUG_IN_FMT_SFZ_PARSE_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/status.h>

namespace lsp
{
    namespace sfz
    {
        LSP_RUNTIME_LIB_PUBLIC
        status_t parse_bool(bool *dst, const char *text);

        LSP_RUNTIME_LIB_PUBLIC
        status_t parse_int(ssize_t *dst, const char *text);

        LSP_RUNTIME_LIB_PUBLIC
        status_t parse_float(float *dst, const char *text);

        LSP_RUNTIME_LIB_PUBLIC
        status_t parse_note(ssize_t *dst, const char *text);

    } /* namespace sfz */
} /* namespace lsp */


#endif /* LSP_PLUG_IN_FMT_SFZ_PARSE_H_ */
