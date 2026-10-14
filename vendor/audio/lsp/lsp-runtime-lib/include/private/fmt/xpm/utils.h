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

#ifndef PRIVATE_FMT_XPM_UTILS_H_
#define PRIVATE_FMT_XPM_UTILS_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/fmt/xpm/ColorItem.h>
#include <lsp-plug.in/fmt/xpm/Header.h>

namespace lsp
{
    namespace xpm
    {

        static inline uint32_t hex_digit(char c)
        {
            if ((c >= '0') && (c <= '9'))
                return c - '0';
            if ((c >= 'a') && (c <= 'f'))
                return c - 'a' + 10;
            if ((c >= 'A') && (c <= 'F'))
                return c - 'A' + 10;
            return 0x10;
        }

        static inline bool is_space(char c)
        {
            switch (c)
            {
                case ' ':
                case '\n':
                case '\r':
                case '\t':
                case '\v':
                    return true;
                default:
                    break;
            }
            return false;
        }

        static inline bool is_blank(char c)
        {
            switch (c)
            {
                case ' ':
                case '\t':
                    return true;
                default:
                    break;
            }
            return false;
        }

        static inline bool is_digit(char c)
        {
            return (c >= '0') && (c <= '9');
        }

        static inline bool is_alpha(char c)
        {
            return ((c >= 'a') && (c <= 'z')) ||
                    ((c >= 'A') && (c <= 'Z')) ||
                    (c == '_');
        }

        static inline bool is_alphadigit(char c)
        {
            return is_digit(c) || is_alpha(c);
        }

        static const char *skip_whitespace(const char *value)
        {
            while (true)
            {
                const char ch = *value;
                switch (ch)
                {
                    case ' ':
                    case '\t':
                    case '\r':
                    case '\v':
                        ++value;
                        break;
                    default:
                        return value;
                }
            }
        }

        const char *match_prefix(const char *str, const char *expected)
        {
            while (true)
            {
                const char ch = *expected;
                if (ch == '\0')
                    return str;
                if (*str != ch)
                    return NULL;

                ++expected;
                ++str;
            }
        }

        const char *advance(const char *str, size_t count)
        {
            for (size_t i=0; i<count; ++i)
            {
                if (*(str++) == '\0')
                    return NULL;
            }

            return str;
        }

        static const char *parse_int(size_t *out, const char *value)
        {
            size_t res = 0;
            size_t digits = 0;

            for (; *value != '\0'; ++value)
            {
                if (!is_digit(*value))
                {
                    if (digits <= 0)
                        return NULL;
                    break;
                }

                // Update value and check for overflow
                res = (res * 10) + (*value - '0');
                if (++digits >= 9)
                    return NULL;
            }

            *out    = res;
            return value;
        }

        static const char *parse_identifier(const char *str)
        {
            if (!is_alpha(*str))
                return NULL;

            ++str;
            while (is_alphadigit(*str))
                ++str;

            return str;
        }

        static const char *parse_color_name(const char *str)
        {
            while (true)
            {
                str = parse_identifier(str);
                if (str == NULL)
                    return NULL;

                // Perform look-ahead of additional word in color name
                if (str[0] != ' ')
                    return str;

                switch (str[1])
                {
                    case 'm':
                    case 's':
                    case 'c':
                        if ((str[2] == '\0') || (is_blank(str[2])))
                            return str;
                        ++str;
                        break;

                    case 'g':
                        if ((str[2] == '\0') || (is_blank(str[2])))
                            return str;
                        if (str[2] != '4')
                        {
                            ++str;
                            break;
                        }
                        if ((str[3] == '\0') || (is_blank(str[3])))
                            return str;
                        ++str;
                        break;

                    default:
                        if (!is_alpha(str[1]))
                            return str;
                        break;
                }
            }
        }

        static const char *parse_color_item(ColorItem & v, const char *str)
        {
            const char * const begin = str;

            if (*str == '#')
            {
                // Parse hexadecimal value
                ++str;
                uint32_t code;
                uint64_t color = 0;

                while ((code = hex_digit(*str)) < 0x10)
                {
                    if ((str - begin) >= 13)
                        return NULL;

                    ++str;
                    color       = (color << 4) | code;
                }

                // Check that color is valid
                const size_t len = str - begin;
                if (len == 7)
                {
                    v.set_rgb24(uint32_t(color));
                    return str;
                }
                else if (len == 13)
                {
                    v.set_rgb48(uint64_t(color));
                    return str;
                }

                return NULL;
            }

            str = parse_color_name(begin);
            if (str == begin)
                return NULL;

            return (v.set_name(begin, str - begin)) ? str : NULL;
        }

        static const char *parse_color(Color & c, const char *str, size_t chars_per_color)
        {
            enum flags_t
            {
                F_MONO      = 1 << 0,
                F_SYMBOLIC  = 1 << 1,
                F_GRAY4     = 1 << 2,
                F_GRAY      = 1 << 3,
                F_COLOR     = 1 << 4
            };

            // Color code
            const char *code = str;
            if ((str = advance(str, chars_per_color)) == NULL)
                return NULL;
            if (!c.set_code(code, chars_per_color))
                return NULL;

            // Visuals
            size_t flags = 0;
            while (true)
            {
                str = skip_whitespace(str);
                switch (*str)
                {
                    case '\0':
                        return (flags == 0) ? NULL : str;

                    case 'm': // Mono
                        if (flags & F_MONO)
                            return NULL;
                        flags |= F_MONO;
                        str = skip_whitespace(str + 1);
                        if ((str = parse_color_item(c.mono_visual(), str)) == NULL)
                            return NULL;
                        break;

                    case 's': // Symbolic
                        if (flags & F_SYMBOLIC)
                            return NULL;
                        flags |= F_SYMBOLIC;
                        str = skip_whitespace(str + 1);
                        if ((str = parse_color_item(c.symbolic_visual(), str)) == NULL)
                            return NULL;
                        break;

                    case 'c': // Color
                        if (flags & F_COLOR)
                            return NULL;
                        flags |= F_COLOR;
                        str = skip_whitespace(str + 1);
                        if ((str = parse_color_item(c.color_visual(), str)) == NULL)
                            return NULL;
                        break;

                    case 'g': // Gray, Gray4
                        if (str[1] == '4') // Gray4
                        {
                            if (flags & F_GRAY4)
                                return NULL;
                            flags |= F_GRAY4;
                            str = skip_whitespace(str + 2);
                            if ((str = parse_color_item(c.gray4_visual(), str)) == NULL)
                                return NULL;
                        }
                        else
                        {
                            if (flags & F_GRAY)
                                return NULL;
                            flags |= F_GRAY;
                            str = skip_whitespace(str + 1);
                            if ((str = parse_color_item(c.gray_visual(), str)) == NULL)
                                return NULL;
                        }
                        break;

                    default: // Invalid character
                        return NULL;
                }
            }
        }

        static const char *parse_xpm_header(header_t & hdr, const char * str)
        {
            // Width
            str = skip_whitespace(str);
            if ((str = parse_int(&hdr.width, str)) == NULL)
                return NULL;

            // Height
            str = skip_whitespace(str);
            if ((str = parse_int(&hdr.height, str)) == NULL)
                return NULL;

            // Colors
            str = skip_whitespace(str);
            if ((str = parse_int(&hdr.num_colors, str)) == NULL)
                return NULL;

            // Chars per pixel
            str = skip_whitespace(str);
            if ((str = parse_int(&hdr.chars_per_pixel, str)) == NULL)
                return NULL;

            // Optional x_hotspot and y_hotspot
            str = skip_whitespace(str);
            const char *hspot = parse_int(&hdr.x_hotspot, str);
            if (hspot != NULL)
            {
                hspot   = skip_whitespace(hspot);
                if ((hspot = parse_int(&hdr.y_hotspot, hspot)) == NULL)
                    return NULL;
                str = hspot;
            }
            else
            {
                hdr.x_hotspot   = 0;
                hdr.y_hotspot   = 0;
            }

            // Optional XPMEXT signature
            str = skip_whitespace(str);
            const char *xpmext = match_prefix(str, "XPMEXT");
            if (xpmext != NULL)
            {
                hdr.has_extensions      = true;
                str     = xpmext;
            }
            else
                hdr.has_extensions      = false;

            return skip_whitespace(str);
        }

        static inline bool verify_xpm_header(const header_t & hdr)
        {
            return
                (hdr.width > 0) &&
                (hdr.height > 0) &&
                (hdr.num_colors > 0) &&
                (hdr.chars_per_pixel > 0) &&
                (hdr.chars_per_pixel <= 12) &&
                (hdr.x_hotspot < hdr.width) &&
                (hdr.y_hotspot < hdr.height);
        }

    } /* namespace xpm */
} /* namespace lsp */

#endif /* PRIVATE_FMT_XPM_UTILS_H_ */
