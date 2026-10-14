/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 20 янв. 2026 г.
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

#ifndef LSP_PLUG_IN_FMT_XPM_PARSER_H_
#define LSP_PLUG_IN_FMT_XPM_PARSER_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/io/IInStream.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/fmt/xpm/Color.h>
#include <lsp-plug.in/fmt/xpm/Extension.h>
#include <lsp-plug.in/fmt/xpm/Header.h>
#include <lsp-plug.in/runtime/LSPString.h>

namespace lsp
{
    namespace xpm
    {
        /**
         * XPM parser interface
         */
        class LSP_RUNTIME_LIB_PUBLIC Parser
        {
            public:
                Parser();
                Parser(const Parser &) = delete;
                Parser(Parser &&) = delete;
                virtual ~Parser();

                Parser & operator = (const Parser &) = delete;
                Parser & operator = (Parser &&) = delete;

            public:
                /**
                 * Read XPM header
                 * @param dst destination buffer to store header
                 * @return status of operation
                 */
                virtual status_t    read_header(header_t *dst);

                /**
                 * Read XPM color
                 * @param dst pointer to store color, may be NULL
                 * @return status of operation
                 */
                virtual status_t    read_color(Color *dst);

                /**
                 * Read the image line to buffer
                 * @param dst destination buffer to store image line, should be of enough
                 *            size to store character data. @note Parser does not store NULL-terminating
                 *            character for the buffer!
                 * @return status of operation
                 */
                virtual status_t    read_line(char *dst);

                /**
                 * Read the image line to buffer
                 * @param dst pointer to store the extension data
                 * @return status of operation
                 */
                virtual status_t    read_ext(Extension *dst);

                /**
                 * Close parser
                 * @return status of operation
                 */
                virtual status_t    close();
        };
    } /* namespace xpm */
} /* namespace lsp */


#endif /* LSP_PLUG_IN_FMT_XPM_PARSER_H_ */
