/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 21 дек. 2019 г.
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

#ifndef LSP_PLUG_IN_FMT_URL_H_
#define LSP_PLUG_IN_FMT_URL_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/common/status.h>

namespace lsp
{
    namespace url
    {
        /**
         * Decode URL-encoded string
         * @param dst destination string to store decoded string
         * @param src source string to parse
         * @return status of operation
         */
        status_t    decode(LSPString *dst, const LSPString *src);

        /**
         * Decode URL-encoded string
         * @param dst destination string to store decoded string
         * @param src source string to parse
         * @param first first character of the source string to start parsing
         * @return status of operation
         */
        status_t    decode(LSPString *dst, const LSPString *src, size_t first);

        /**
         * Decode URL-encoded string
         * @param dst destination string to store decoded string
         * @param src source string to parse
         * @param first first character of the source string to start parsing
         * @param last last character of the source string to start parsing
         * @return status of operation
         */
        status_t    decode(LSPString *dst, const LSPString *src, size_t first, size_t last);

    } /* namespace url */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_URL_H_ */
