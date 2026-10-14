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

#ifndef PRIVATE_FMT_XPM_XPM1STREAMPARSER_H_
#define PRIVATE_FMT_XPM_XPM1STREAMPARSER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/fmt/xpm/Parser.h>
#include <lsp-plug.in/stdlib/string.h>

#include <private/fmt/xpm/Tokenizer.h>
#include <private/fmt/xpm/utils.h>

namespace lsp
{
    namespace xpm
    {
        /**
         * Parser for XPM1 streaming format
         */
        class LSP_HIDDEN_MODIFIER XPM1StreamParser: public Parser
        {
            private:
                enum state_t
                {
                    ST_HEADER,
                    ST_COLORS_LOOKUP,
                    ST_COLORS,
                    ST_PIXELS_LOOKUP,
                    ST_PIXELS,
                    ST_EOF
                };

                static const char * const postfixes[];
                static const size_t INVALID_VALUE = ~size_t(0);

            private:
                Tokenizer              *pTokenizer;
                char                   *sIconId;
                header_t                sHeader;
                state_t                 enState;
                size_t                  nColors;
                size_t                  nRows;

            private:
                status_t do_close()
                {
                    if (sIconId != NULL)
                    {
                        free(sIconId);
                        sIconId         = NULL;
                    }

                    if (pTokenizer == NULL)
                        return STATUS_OK;

                    status_t res = pTokenizer->close();
                    delete pTokenizer;
                    pTokenizer = NULL;

                    return res;
                }

                status_t obtain_icon_id(const char *name)
                {
                    const ssize_t len = strlen(name);

                    for (const char * const * postfix = postfixes; *postfix != NULL; ++postfix)
                    {
                        const ssize_t offset = len - strlen(*postfix);
                        if (offset < 0)
                            return STATUS_CORRUPTED_FILE;
                        if (strcmp(&name[offset], *postfix) == 0)
                        {
                            sIconId = static_cast<char *>(malloc(offset + 1));
                            if (sIconId == NULL)
                                return STATUS_NO_MEM;
                            memcpy(sIconId, name, offset);
                            sIconId[offset] = '\0';
                            return STATUS_OK;
                        }
                    }

                    return STATUS_CORRUPTED_FILE;
                }

            public:
                explicit XPM1StreamParser(Tokenizer * tokenizer)
                {
                    pTokenizer              = tokenizer;
                    sIconId                 = NULL;

                    sHeader.version         = VERSION_XPM1;
                    sHeader.width           = INVALID_VALUE;
                    sHeader.height          = INVALID_VALUE;
                    sHeader.num_colors      = INVALID_VALUE;
                    sHeader.chars_per_pixel = INVALID_VALUE;
                    sHeader.x_hotspot       = INVALID_VALUE;
                    sHeader.y_hotspot       = INVALID_VALUE;
                    sHeader.has_extensions  = false;

                    enState                 = ST_HEADER;
                    nColors                 = 0;
                    nRows                   = 0;
                }

                virtual ~XPM1StreamParser() override
                {
                    do_close();
                }

            public:
                virtual status_t close() override
                {
                    return do_close();
                }

                virtual status_t read_header(header_t *dst) override
                {
                    if (pTokenizer == NULL)
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
                    status_t res;
                    token_type_t ttype  = TOK_INVALID;
                    const char *tvalue  = NULL;
                    size_t num_defines  = 0;
                    size_t format       = INVALID_VALUE;

                    while (true)
                    {
                        // Read '#define' token
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;

                        // Check token type
                        if (ttype != TOK_DEFINE)
                        {
                            if (num_defines == 0)
                            {
                                pTokenizer->unread_token();
                                return STATUS_UNSUPPORTED_FORMAT;
                            }
                            break;
                        }

                        // Read macro name
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if (ttype != TOK_IDENTIFIER)
                            return STATUS_CORRUPTED_FILE;

                        // Obtain icon name if not defined
                        if ((num_defines++) == 0)
                        {
                            if ((res = obtain_icon_id(tvalue)) != STATUS_OK)
                                return STATUS_CORRUPTED_FILE;
                        }

                        // Look at the header value
                        if ((tvalue = match_prefix(tvalue, sIconId)) == NULL)
                            return STATUS_CORRUPTED_FILE;

                        // Prepare to parse value
                        size_t *dst = NULL;
                        if (strcmp(tvalue, "_width") == 0)
                            dst     = &sHeader.width;
                        else if (strcmp(tvalue, "_format") == 0)
                            dst     = &format;
                        else if (strcmp(tvalue, "_height") == 0)
                            dst     = &sHeader.height;
                        else if (strcmp(tvalue, "_ncolors") == 0)
                            dst     = &sHeader.num_colors;
                        else if (strcmp(tvalue, "_x_hotspot") == 0)
                            dst     = &sHeader.x_hotspot;
                        else if (strcmp(tvalue, "_y_hotspot") == 0)
                            dst     = &sHeader.y_hotspot;
                        else if (strcmp(tvalue, "_chars_per_pixel") == 0)
                            dst     = &sHeader.chars_per_pixel;
                        else
                            return STATUS_CORRUPTED_FILE;

                        // Check for duplicates
                        if (*dst != INVALID_VALUE)
                            return STATUS_CORRUPTED_FILE;

                        // Read the integer value
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if (ttype != TOK_INTEGER)
                            return STATUS_CORRUPTED_FILE;

                        if ((tvalue = parse_int(dst, tvalue)) == NULL)
                            return STATUS_CORRUPTED_FILE;
                        if ((*tvalue) != '\0')
                            return STATUS_CORRUPTED_FILE;
                    }

                    // Check current token for "static" word
                    if ((ttype != TOK_IDENTIFIER) || (strcmp(tvalue, "static") != 0))
                        return STATUS_CORRUPTED_FILE;

                    // Check that all mandatory values have been specified
                    if (format != 1)
                        return STATUS_CORRUPTED_FILE;

                    if ((sHeader.width == INVALID_VALUE) ||
                        (sHeader.height == INVALID_VALUE) ||
                        (sHeader.num_colors == INVALID_VALUE) ||
                        (sHeader.chars_per_pixel == INVALID_VALUE))
                        return STATUS_CORRUPTED_FILE;

                    // Set default values to 'extended' parameters
                    if (sHeader.x_hotspot == INVALID_VALUE)
                        sHeader.x_hotspot   = 0;
                    if (sHeader.y_hotspot == INVALID_VALUE)
                        sHeader.y_hotspot   = 0;

                    // Check that values are in valid ranges
                    if (!verify_xpm_header(sHeader))
                        return STATUS_CORRUPTED_FILE;

                    // Return header and update state
                    *dst     = sHeader;
                    enState  = ST_COLORS_LOOKUP;

                    return STATUS_OK;
                }

                virtual status_t read_color(Color *dst) override
                {
                    if (pTokenizer == NULL)
                        return STATUS_CLOSED;
                    if (dst == NULL)
                        return STATUS_BAD_ARGUMENTS;

                    status_t res;
                    token_type_t ttype  = TOK_INVALID;
                    const char *tvalue  = NULL;

                    // Need to lookup for color block?
                    if (enState == ST_COLORS_LOOKUP)
                    {
                        // static [const] char * [const] <prefix>_colors[] = {

                        // Read 'char' identifier
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if ((ttype == TOK_IDENTIFIER) && (strcmp(tvalue, "const") == 0))
                        {
                            if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                                return res;
                        }
                        if ((ttype != TOK_IDENTIFIER) || (strcmp(tvalue, "char") != 0))
                            return STATUS_CORRUPTED_FILE;

                        // Read '*'
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if (ttype != TOK_ASTERISK)
                            return STATUS_CORRUPTED_FILE;

                        // Read variable name
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if ((ttype == TOK_IDENTIFIER) && (strcmp(tvalue, "const") == 0))
                        {
                            if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                                return res;
                        }
                        if (ttype != TOK_IDENTIFIER)
                            return STATUS_CORRUPTED_FILE;
                        if ((tvalue = match_prefix(tvalue, sIconId)) == NULL)
                            return STATUS_CORRUPTED_FILE;
                        if (strcmp(tvalue, "_colors") != 0)
                            return STATUS_CORRUPTED_FILE;

                        // Read '[]' braces
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if (ttype != TOK_LQBRACKET)
                            return STATUS_CORRUPTED_FILE;
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if (ttype != TOK_RQBRACKET)
                            return STATUS_CORRUPTED_FILE;

                        // Read assign ('=')
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if (ttype != TOK_ASSIGN)
                            return STATUS_CORRUPTED_FILE;

                        // Read start of array ('{')
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if (ttype != TOK_LBRACE)
                            return STATUS_CORRUPTED_FILE;

                        // OK, now is all successful
                        enState = ST_COLORS;
                    }

                    // Check that there are still colors available
                    if (enState != ST_COLORS)
                        return (nColors >= sHeader.num_colors) ? STATUS_NOT_FOUND : STATUS_BAD_STATE;
                    else if (nColors >= sHeader.num_colors)
                        return STATUS_NOT_FOUND;

                    Color tmp;

                    // Read color code
                    if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                        return res;
                    if (ttype == TOK_SEMICOLON)
                    {
                        if (nColors < sHeader.num_colors)
                            return STATUS_CORRUPTED_FILE;

                    }
                    if ((ttype != TOK_STRING) || (strlen(tvalue) != sHeader.chars_per_pixel))
                        return STATUS_CORRUPTED_FILE;
                    if (!tmp.set_code(tvalue))
                        return STATUS_NO_MEM;

                    // Read separator
                    if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                        return res;
                    if (ttype != TOK_COMMA)
                        return STATUS_CORRUPTED_FILE;

                    // Read color value
                    if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                        return res;
                    if (ttype != TOK_STRING)
                        return STATUS_CORRUPTED_FILE;

                    // Parse color
                    tvalue = parse_color_item(tmp.color_visual(), tvalue);
                    if ((tvalue == NULL) || (*tvalue != '\0'))
                        return STATUS_CORRUPTED_FILE;

                    ++nColors;

                    // Read separator
                    if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                        return res;

                    if (ttype == TOK_RBRACE)
                    {
                        if (nColors < sHeader.num_colors)
                            return STATUS_CORRUPTED_FILE;

                        // Semicolon ';' should be after the rbrace
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if (ttype != TOK_SEMICOLON)
                            return STATUS_CORRUPTED_FILE;

                        // Update state
                        enState     = ST_PIXELS_LOOKUP;
                    }
                    else if (ttype == TOK_COMMA)
                    {
                        if (nColors >= sHeader.num_colors)
                        {
                            // Require '}' rbrace
                            if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                                return res;
                            if (ttype != TOK_RBRACE)
                                return STATUS_CORRUPTED_FILE;

                            // Semicolon ';' should be after the rbrace
                            if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                                return res;
                            if (ttype != TOK_SEMICOLON)
                                return STATUS_CORRUPTED_FILE;

                            enState     = ST_PIXELS_LOOKUP;
                        }
                    }
                    else
                        return STATUS_CORRUPTED_FILE;

                    // All seems to be OK
                    if (dst != NULL)
                        tmp.swap(dst);

                    return STATUS_OK;
                }

                virtual status_t read_line(char *dst) override
                {
                    if (pTokenizer == NULL)
                        return STATUS_CLOSED;
                    if (dst == NULL)
                        return STATUS_BAD_ARGUMENTS;

                    status_t res;
                    token_type_t ttype  = TOK_INVALID;
                    const char *tvalue  = NULL;

                    // Need to lookup for color block?
                    if (enState == ST_PIXELS_LOOKUP)
                    {
                        // static [const] char * [const] <prefix>_pixels[] = {
                        // Read 'static' identifier
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if ((ttype != TOK_IDENTIFIER) || (strcmp(tvalue, "static") != 0))
                            return STATUS_CORRUPTED_FILE;

                        // Read 'char' identifier
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if ((ttype == TOK_IDENTIFIER) && (strcmp(tvalue, "const") == 0))
                        {
                            if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                                return res;
                        }
                        if ((ttype != TOK_IDENTIFIER) || (strcmp(tvalue, "char") != 0))
                            return STATUS_CORRUPTED_FILE;

                        // Read '*'
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if (ttype != TOK_ASTERISK)
                            return STATUS_CORRUPTED_FILE;

                        // Read variable name
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if ((ttype == TOK_IDENTIFIER) && (strcmp(tvalue, "const") == 0))
                        {
                            if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                                return res;
                        }
                        if (ttype != TOK_IDENTIFIER)
                            return STATUS_CORRUPTED_FILE;
                        if ((tvalue = match_prefix(tvalue, sIconId)) == NULL)
                            return STATUS_CORRUPTED_FILE;
                        if (strcmp(tvalue, "_pixels") != 0)
                            return STATUS_CORRUPTED_FILE;

                        // Read '[]' braces
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if (ttype != TOK_LQBRACKET)
                            return STATUS_CORRUPTED_FILE;
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if (ttype != TOK_RQBRACKET)
                            return STATUS_CORRUPTED_FILE;

                        // Read assign ('=')
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if (ttype != TOK_ASSIGN)
                            return STATUS_CORRUPTED_FILE;

                        // Read start of array ('{')
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if (ttype != TOK_LBRACE)
                            return STATUS_CORRUPTED_FILE;

                        // OK, now is all successful
                        enState = ST_PIXELS;
                    }

                    // Check that there are still pixels available
                    if (enState != ST_PIXELS)
                        return (nRows >= sHeader.height) ? STATUS_NOT_FOUND : STATUS_BAD_STATE;
                    else if (nRows >= sHeader.height)
                        return STATUS_NOT_FOUND;

                    // Read string
                    if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                        return res;
                    const size_t row_size = sHeader.width * sHeader.chars_per_pixel;
                    if ((ttype != TOK_STRING) || (strlen(tvalue) != row_size))
                        return STATUS_CORRUPTED_FILE;

                    ++nRows;
                    if (dst != NULL)
                        memcpy(dst, tvalue, row_size);

                    // Read separator
                    if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                        return res;

                    if (ttype == TOK_RBRACE)
                    {
                        if (nRows < sHeader.height)
                            return STATUS_CORRUPTED_FILE;

                        // Semicolon ';' should be after the rbrace
                        if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                            return res;
                        if (ttype != TOK_SEMICOLON)
                            return STATUS_CORRUPTED_FILE;

                        // Update state
                        enState     = ST_EOF;
                    }
                    else if (ttype == TOK_COMMA)
                    {
                        if (nRows >= sHeader.height)
                        {
                            // Require '}' rbrace
                            if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                                return res;
                            if (ttype != TOK_RBRACE)
                                return STATUS_CORRUPTED_FILE;

                            // Semicolon ';' should be after the rbrace
                            if ((res = pTokenizer->read_token(ttype, tvalue)) != STATUS_OK)
                                return res;
                            if (ttype != TOK_SEMICOLON)
                                return STATUS_CORRUPTED_FILE;

                            enState     = ST_EOF;
                        }
                    }
                    else
                        return STATUS_CORRUPTED_FILE;

                    return STATUS_OK;
                }

                virtual status_t read_ext(Extension *dst) override
                {
                    // XPM1 has no extensions
                    return (pTokenizer == NULL) ? STATUS_CLOSED : STATUS_NOT_FOUND;
                }

        };

        const char * const XPM1StreamParser::postfixes[] =
        {
            "_width",
            "_format",
            "_height",
            "_ncolors",
            "_x_hotspot",
            "_y_hotspot",
            "_chars_per_pixel",
            NULL
        };

    } /* namespace xpm */
} /* namespace lsp */




#endif /* PRIVATE_FMT_XPM_XPM1STREAMPARSER_H_ */
