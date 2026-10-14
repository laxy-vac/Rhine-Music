/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 18 янв. 2026 г.
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

#ifndef LSP_PLUG_IN_FMT_XPM_XPM_H_
#define LSP_PLUG_IN_FMT_XPM_XPM_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/fmt/xpm/Parser.h>

namespace lsp
{
    namespace xpm
    {
        /**
         * Open parser for reading file
         *
         * @param path UTF-8 path to the file
         * @param dst pointer to store pointer to the parser. The caller code is
         *            responsible for calling close() and delete the parser.
         * @return status of operation
         */
        status_t    open(Parser **dst, const char *path);

        /**
         * Open parser for reading file
         *
         * @param path string representation of path to the file
         * @param dst pointer to store pointer to the parser. The caller code is
         *            responsible for calling close() and delete the parser.
         * @return status of operation
         */
        status_t    open(Parser **dst, const LSPString *path);

        /**
         * Open parser for reading file
         * @param path path to the file
         * @param dst pointer to store pointer to the parser. The caller code is
         *            responsible for calling close() and delete the parser.
         * @return status of operation
         */
        status_t    open(Parser **dst, const io::Path *path);

        /**
         * Wrap memory chunk with parser
         * @param str string to wrap
         * @param dst pointer to store pointer to the parser. The caller code is
         *            responsible for calling close() and delete the parser.
         * @return status of operation
         */
        status_t    wrap(Parser **dst, const char *str);

        /**
         * Wrap buffer with parser
         * @param buf buffer to wrap
         * @param len length of buffer to wrap
         * @param dst pointer to store pointer to the parser. The caller code is
         *            responsible for calling close() and delete the parser.
         * @return status of operation
         */
        status_t    wrap(Parser **dst, const void *buf, size_t len);

        /**
         * Wrap buffer with parser
         * @param buf buffer to wrap
         * @param len length of buffer to wrap
         * @param drop memory dropping flags
         * @param dst pointer to store pointer to the parser. The caller code is
         *            responsible for calling close() and delete the parser.
         * @return status of operation
         */
        status_t    wrap(Parser **dst, void *buf, size_t len, lsp_memdrop_t drop = MEMDROP_NONE);

        /**
         * Wrap input stream with parser
         * @param dst pointer to store pointer to the parser. The caller code is
         *            responsible for calling close() and delete the parser.
         * @param is input stream
         * @param flags wrap flags
         * @return status of operation
         */
        status_t    wrap(Parser **dst, io::IInStream *is, size_t flags = WRAP_NONE);

        /**
         * Make an XPM1 parser for built-in image
         * @param dst pointer to store pointer to the parser. The caller code is
         *            responsible for calling close() and delete the parser.
         * @param width the width of image in pixels
         * @param height the height of image in pixels
         * @param num_colors the number of colors
         * @param chars_per_pixel number of characters per pixel
         * @param colors array of color definitions
         * @param pixels array of pixel definitions
         * @return status of operation
         */
        status_t    make_xpm1(Parser **dst,
                size_t width,
                size_t height,
                size_t num_colors,
                size_t chars_per_pixel,
                const char * const * colors,
                const char * const * pixels);

        /**
         * Make an XPM3 parser for built-in image
         * @param dst pointer to store pointer to the parser. The caller code is
         *            responsible for calling close() and delete the parser.
         * @param lines the XPM3 data lines
         * @param count number of data lines
         * @return status of operation
         */
        status_t    make_xpm3(Parser **dst, const char * const * lines, size_t count);

    } /* namespace xpm */
} /* namespace lsp */


#endif /* LSP_PLUG_IN_FMT_XPM_XPM_H_ */
