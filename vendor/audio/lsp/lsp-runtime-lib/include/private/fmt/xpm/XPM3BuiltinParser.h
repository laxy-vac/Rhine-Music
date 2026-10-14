/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 23 янв. 2026 г.
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

#ifndef PRIVATE_FMT_XPM_XPM3BUILTINPARSER_H_
#define PRIVATE_FMT_XPM_XPM3BUILTINPARSER_H_


#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/fmt/xpm/Parser.h>
#include <lsp-plug.in/stdlib/string.h>

#include <private/fmt/xpm/utils.h>

namespace lsp
{
    namespace xpm
    {
        /**
         * Parser for XPM3 built-in format
         */
        class LSP_HIDDEN_MODIFIER XPM3BuiltinParser: public Parser
        {
            private:
                enum state_t
                {
                    ST_HEADER,
                    ST_COLORS,
                    ST_PIXELS,
                    ST_EXTENSIONS,
                    ST_EOF
                };

            private:
                header_t                sHeader;
                const char * const     *vLines;
                state_t                 enState;
                size_t                  nColors;
                size_t                  nRows;
                size_t                  nLines;

            private:
                inline const char *get_line()
                {
                    if (nLines <= 0)
                        return NULL;
                    --nLines;
                    return *(vLines++);
                }

            public:
                XPM3BuiltinParser(const char * const * lines, size_t count)
                {
                    sHeader.version         = VERSION_XPM3;
                    sHeader.width           = 0;
                    sHeader.height          = 0;
                    sHeader.num_colors      = 0;
                    sHeader.chars_per_pixel = 0;
                    sHeader.x_hotspot       = 0;
                    sHeader.y_hotspot       = 0;
                    sHeader.has_extensions  = false;

                    vLines                  = lines;
                    enState                 = ST_HEADER;
                    nColors                 = 0;
                    nRows                   = 0;
                    nLines                  = count;
                }

                virtual ~XPM3BuiltinParser()
                {
                    vLines      = NULL;
                }

            public:
                virtual status_t read_header(header_t *dst) override
                {
                    if (vLines == NULL)
                        return STATUS_CLOSED;
                    if (dst == NULL)
                        return STATUS_BAD_ARGUMENTS;

                    // Header already parsed?
                    if (enState != ST_HEADER)
                    {
                        *dst        = sHeader;
                        return STATUS_OK;
                    }

                    // Read header contents
                    const char *tvalue  = get_line();
                    if (tvalue == NULL)
                        return STATUS_CORRUPTED_FILE;

                    if ((tvalue = parse_xpm_header(sHeader, tvalue)) == NULL)
                        return STATUS_CORRUPTED_FILE;
                    if ((*tvalue) != '\0')
                        return STATUS_CORRUPTED_FILE;

                    // Check that values are in valid ranges
                    if (!verify_xpm_header(sHeader))
                        return STATUS_CORRUPTED_FILE;

                    // Return header and update state
                    *dst        = sHeader;
                    enState     = ST_COLORS;

                    return STATUS_OK;
                }

                virtual status_t read_color(Color *dst) override
                {
                    if (vLines == NULL)
                        return STATUS_CLOSED;
                    if (dst == NULL)
                        return STATUS_BAD_ARGUMENTS;

                    // Check that there are still colors available
                    if (enState != ST_COLORS)
                        return (nColors >= sHeader.num_colors) ? STATUS_NOT_FOUND : STATUS_BAD_STATE;
                    else if (nColors >= sHeader.num_colors)
                    {
                        enState = ST_PIXELS;
                        return STATUS_NOT_FOUND;
                    }

                    Color tmp;

                    // Read color line
                    const char *tvalue  = get_line();
                    if (tvalue == NULL)
                        return STATUS_CORRUPTED_FILE;

                    // Parse color
                    tvalue = parse_color(tmp, tvalue, sHeader.chars_per_pixel);
                    if ((tvalue == NULL) || (*tvalue != '\0'))
                        return STATUS_CORRUPTED_FILE;

                    if ((++nColors) >= sHeader.num_colors)
                        enState     = ST_PIXELS;

                    // All seems to be OK
                    if (dst != NULL)
                        tmp.swap(dst);

                    return STATUS_OK;
                }

                virtual status_t read_line(char *dst) override
                {
                    if (vLines == NULL)
                        return STATUS_CLOSED;
                    if (dst == NULL)
                        return STATUS_BAD_ARGUMENTS;

                    // Check that there are still pixels available
                    if (enState != ST_PIXELS)
                        return (nRows >= sHeader.height) ? STATUS_NOT_FOUND : STATUS_BAD_STATE;
                    else if (nRows >= sHeader.height)
                    {
                        enState = ST_EXTENSIONS;
                        return STATUS_NOT_FOUND;
                    }

                    // Read pixel line
                    const char *tvalue  = get_line();
                    if (tvalue == NULL)
                        return STATUS_CORRUPTED_FILE;

                    const size_t row_size = sHeader.width * sHeader.chars_per_pixel;
                    if (strlen(tvalue) != row_size)
                        return STATUS_CORRUPTED_FILE;

                    // Commit result and update state
                    if (dst != NULL)
                        memcpy(dst, tvalue, row_size);

                    if ((++nRows) >= sHeader.height)
                        enState     = (sHeader.has_extensions) ? ST_EXTENSIONS : ST_EOF;

                    return STATUS_OK;
                }

                virtual status_t read_ext(Extension *dst) override
                {
                    if (vLines == NULL)
                        return STATUS_CLOSED;
                    if (dst == NULL)
                        return STATUS_BAD_ARGUMENTS;

                    // Check that there are still pixels available
                    if (enState < ST_EXTENSIONS)
                        return STATUS_BAD_STATE;
                    else if (enState > ST_EXTENSIONS)
                        return STATUS_NOT_FOUND;

                    // Read extension
                    Extension tmp;
                    const char *tvalue  = get_line();
                    if (tvalue == NULL)
                    {
                        enState     = ST_EOF;
                        return STATUS_NOT_FOUND;
                    }

                    // XPMEXT token
                    if ((tvalue = match_prefix(tvalue, "XPMEXT")) == NULL)
                        return STATUS_CORRUPTED_FILE;
                    if (!is_blank(*tvalue++))
                        return STATUS_CORRUPTED_FILE;

                    // Extension name
                    const char *id = parse_identifier(tvalue);
                    if ((id == NULL) || (id <= tvalue))
                        return STATUS_CORRUPTED_FILE;
                    if (!tmp.set_name(tvalue, id - tvalue))
                        return STATUS_NO_MEM;

                    // Extension data
                    tvalue = id;
                    if (*tvalue == '\0')
                    {
                        // Multiline extension
                        size_t lines = 0;
                        while (true)
                        {
                            // Read extension line
                            if ((tvalue = get_line()) == NULL)
                                return STATUS_CORRUPTED_FILE;

                            // End of extension lines?
                            if (strcmp(tvalue, "XPMENDEXT") == 0)
                            {
                                if (lines <= 0)
                                    return STATUS_CORRUPTED_FILE;
                                break;
                            }

                            if (!tmp.add_row(tvalue))
                                return STATUS_NO_MEM;
                            ++lines;
                        }
                    }
                    else if (is_blank(*tvalue))
                    {
                        // Single-line extension
                        ++tvalue;
                        if (!tmp.add_row(tvalue))
                            return STATUS_NO_MEM;
                    }
                    else
                        return STATUS_CORRUPTED_FILE;

                    // All seems to be OK
                    if (dst != NULL)
                        tmp.swap(dst);

                    return STATUS_OK;
                }

                virtual status_t close() override
                {
                    vLines          = NULL;

                    return STATUS_OK;
                }
        };

    } /* namespace xpm */
} /* namespace lsp */


#endif /* PRIVATE_FMT_XPM_XPM3BUILTINPARSER_H_ */
