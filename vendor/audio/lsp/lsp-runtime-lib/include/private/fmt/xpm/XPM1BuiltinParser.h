/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 21 янв. 2026 г.
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

#ifndef PRIVATE_FMT_XPM_XPM1BUILTINPARSER_H_
#define PRIVATE_FMT_XPM_XPM1BUILTINPARSER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/fmt/xpm/Parser.h>
#include <lsp-plug.in/stdlib/string.h>

#include <private/fmt/xpm/utils.h>

namespace lsp
{
    namespace xpm
    {
        /**
         * Parser for XPM1 built-in format
         */
        class LSP_HIDDEN_MODIFIER XPM1BuiltinParser: public Parser
        {
            private:
                header_t                sHeader;
                const char * const     *vColors;
                const char * const     *vPixels;
                size_t                  nColors;
                size_t                  nRows;

            public:
                XPM1BuiltinParser(const header_t & header, const char * const * colors, const char * const * pixels)
                {
                    sHeader     = header;
                    vColors     = colors;
                    vPixels     = pixels;
                    nColors     = 0;
                    nRows       = 0;
                }

                virtual ~XPM1BuiltinParser()
                {
                    vColors     = NULL;
                    vPixels     = NULL;
                }

            public:
                virtual status_t read_header(header_t *dst) override
                {
                    if (dst == NULL)
                        return STATUS_BAD_ARGUMENTS;

                    *dst        = sHeader;
                    return STATUS_OK;
                }

                virtual status_t read_color(Color *dst) override
                {
                    if (dst == NULL)
                        return STATUS_BAD_ARGUMENTS;

                    if (vColors == NULL)
                        return STATUS_CLOSED;

                    // Check that there are still colors available
                    if (nColors >= sHeader.num_colors)
                        return STATUS_NOT_FOUND;

                    Color tmp;
                    const size_t offset = nColors * 2;

                    // Obtain color key
                    const char *key     = vColors[offset];
                    if (key == NULL)
                        return STATUS_CORRUPTED_FILE;

                    // Obtain color value
                    const char *value   = vColors[offset + 1];
                    if (value == NULL)
                        return STATUS_CORRUPTED_FILE;

                    // Validate key
                    if (strlen(key) != sHeader.chars_per_pixel)
                        return STATUS_CORRUPTED_FILE;
                    if (!tmp.set_code(key))
                        return STATUS_NO_MEM;

                    // Validate value
                    const size_t vlen   = strlen(value);
                    if (vlen <= 0)
                        return STATUS_CORRUPTED_FILE;
                    if (value[0] != '#')
                        return STATUS_CORRUPTED_FILE;

                    // Parse color value
                    value = parse_color_item(tmp.color_visual(), value);
                    if ((value == NULL) || (*value != '\0'))
                        return STATUS_CORRUPTED_FILE;

                    // All seems to be OK
                    ++nColors;
                    if (dst != NULL)
                        tmp.swap(dst);

                    return STATUS_OK;
                }

                virtual status_t read_line(char *dst) override
                {
                    if (dst == NULL)
                        return STATUS_BAD_ARGUMENTS;

                    if (vPixels == NULL)
                        return STATUS_CLOSED;

                    // Check that all colors have been read previously
                    if (nColors < sHeader.num_colors)
                        return STATUS_BAD_STATE;

                    // Check that there are still rows available
                    if (nRows >= sHeader.height)
                        return STATUS_NOT_FOUND;

                    // Get the row and validate
                    const char * const row = vPixels[nRows];
                    const size_t bytes = strlen(row);
                    if (bytes != sHeader.chars_per_pixel * sHeader.width)
                        return STATUS_CORRUPTED_FILE;

                    // Now we are ready to return the line
                    if (dst != NULL)
                        memcpy(dst, row, bytes);
                    ++nRows;

                    return STATUS_OK;
                }

                virtual status_t read_ext(Extension *dst) override
                {
                    if (dst == NULL)
                        return STATUS_BAD_ARGUMENTS;

                    if ((vColors == NULL) || (vPixels == NULL))
                        return STATUS_CLOSED;

                    // XPM1 has no extensions
                    return STATUS_NOT_FOUND;
                }

                virtual status_t close() override
                {
                    vColors         = NULL;
                    vPixels         = NULL;

                    return STATUS_OK;
                }
        };

    } /* namespace xpm */
} /* namespace lsp */

#endif /* PRIVATE_FMT_XPM_XPM1BUILTINPARSER_H_ */
