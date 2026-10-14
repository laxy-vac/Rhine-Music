/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 28 янв. 2026 г.
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

#ifndef PRIVATE_MM_BITMAP_XPM_H_
#define PRIVATE_MM_BITMAP_XPM_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/lltl/hash_index.h>
#include <lsp-plug.in/fmt/xpm/xpm.h>
#include <lsp-plug.in/mm/Bitmap.h>

namespace lsp
{
    namespace mm
    {
        typedef struct xpm_color_t
        {
            uint32_t value;
            char id[];
        } xpm_color_t;

        typedef lltl::hash_index<const char, xpm_color_t> xpm_colors_t;

        enum xpm_color_schema_t
        {
            XPM_MONO,
            XPM_GRAY4,
            XPM_GRAY,
            XPM_RGB
        };

        static void free_xpm_colors(xpm_colors_t & colors)
        {
            for (lltl::iterator<xpm_color_t> it = colors.values(); it; ++it)
                free(it.get());
            colors.flush();
        }

        static void xpm_convert_color(lsp::Color & dst, const xpm::ColorItem * const * list, IColorMap *map)
        {
            for (size_t i=0; i<5; ++i)
            {
                const xpm::ColorItem *item = list[i];
                if (!item->is_set())
                    continue;
                if (item->is_none())
                {
                    dst.set_rgba(0.0f, 0.0f, 0.0f, 1.0f);
                    return;
                }
                else if ((item->is_name()) && (map != NULL))
                {
                    if (map->resolve(dst, item->name()))
                        return;
                }
                else if (item->get(dst))
                    return;
            }

            // Fully transparent color by default
            dst.set_rgba(0.0f, 0.0f, 0.0f, 1.0f);
        }

        status_t Bitmap::load_xpm(io::IInStream *is, pixel_format_t format, IColorMap *map)
        {
            // Open parser
            xpm::Parser *parser = NULL;
            status_t res = xpm::wrap(&parser, is, WRAP_NONE);
            if (res != STATUS_OK)
                return res;
            lsp_finally {
                if (parser != NULL)
                {
                    parser->close();
                    delete parser;
                }
            };

            // Read header
            xpm::header_t hdr;
            if ((res = parser->read_header(&hdr)) != STATUS_OK)
                return res;

            // Skip empty bitmap
            if ((hdr.width <= 0) || (hdr.height <= 0))
            {
                reset();
                enFormat    = format;
                return STATUS_OK;
            }

            // Determine pixel format for loading
            xpm_color_schema_t schema = XPM_RGB;
            pixel_format_t img_pixfmt = format;
            switch (format)
            {
                case mm::PIXFMT_A1:
                    img_pixfmt  = mm::PIXFMT_A8;
                    schema      = XPM_MONO;
                    break;
                case mm::PIXFMT_G1:
                    img_pixfmt  = mm::PIXFMT_G8;
                    schema      = XPM_MONO;
                    break;
                case mm::PIXFMT_A4:
                    img_pixfmt  = mm::PIXFMT_A8;
                    schema      = XPM_GRAY4;
                    break;
                case mm::PIXFMT_G4:
                    img_pixfmt  = mm::PIXFMT_G8;
                    schema      = XPM_GRAY4;
                    break;
                case mm::PIXFMT_A8:
                    img_pixfmt  = mm::PIXFMT_A8;
                    schema      = XPM_GRAY;
                    break;
                case mm::PIXFMT_G8:
                    img_pixfmt  = mm::PIXFMT_G8;
                    schema      = XPM_GRAY;
                    break;
                case mm::PIXFMT_RGB888:
                case mm::PIXFMT_BGR888:
                case mm::PIXFMT_RGBA8888:
                case mm::PIXFMT_BGRA8888:
                case mm::PIXFMT_PRGBA8888:
                case mm::PIXFMT_PBGRA8888:
                    schema      = XPM_RGB;
                    break;
                default:
                    schema      = XPM_RGB;
                    img_pixfmt  = PIXFMT_BGRA8888;
                    break;
            }

            // Initialize color palette
            xpm_colors_t palette;
            const size_t szof_color = sizeof(xpm_color_t) + (hdr.chars_per_pixel + 1) * sizeof(char);
            lsp_finally { free_xpm_colors(palette); };
            xpm::Color xpm_color;
            lsp::Color tmp_color;

            const xpm::ColorItem * color_order[5];
            switch (schema)
            {
                case XPM_MONO:
                    color_order[0] = & xpm_color.mono_visual();
                    color_order[1] = & xpm_color.gray4_visual();
                    color_order[2] = & xpm_color.gray_visual();
                    color_order[3] = & xpm_color.color_visual();
                    break;

                case XPM_GRAY4:
                    color_order[0] = & xpm_color.gray4_visual();
                    color_order[1] = & xpm_color.mono_visual();
                    color_order[2] = & xpm_color.gray_visual();
                    color_order[3] = & xpm_color.color_visual();
                    break;

                case XPM_GRAY:
                    color_order[0] = & xpm_color.gray_visual();
                    color_order[1] = & xpm_color.gray4_visual();
                    color_order[2] = & xpm_color.mono_visual();
                    color_order[3] = & xpm_color.color_visual();
                    break;

                case XPM_RGB:
                default:
                    color_order[0] = & xpm_color.color_visual();
                    color_order[1] = & xpm_color.gray_visual();
                    color_order[2] = & xpm_color.gray4_visual();
                    color_order[3] = & xpm_color.mono_visual();
                    break;
            }
            color_order[4] = & xpm_color.symbolic_visual();

            for (size_t i=0; i<hdr.num_colors; ++i)
            {
                // Read color
                if ((res = parser->read_color(&xpm_color)) != STATUS_OK)
                    return (res == STATUS_NOT_FOUND) ? STATUS_CORRUPTED_FILE : res;

                // Convert color
                xpm_convert_color(tmp_color, color_order, map);

                // Register color
                xpm_color_t *p_color = static_cast<xpm_color_t *>(malloc(szof_color));
                if (p_color == NULL)
                    return STATUS_NO_MEM;
                memcpy(p_color->id, xpm_color.code(), hdr.chars_per_pixel);
                p_color->id[hdr.chars_per_pixel] = '\0';

                if (!palette.create(p_color->id, p_color))
                {
                    res = (palette.contains(p_color->id)) ? STATUS_CORRUPTED_FILE : STATUS_NO_MEM;
                    free(p_color);
                    return res;
                }

                switch (img_pixfmt)
                {
                    case mm::PIXFMT_A1:
                    case mm::PIXFMT_A2:
                    case mm::PIXFMT_A4:
                    case mm::PIXFMT_A8:
                        p_color->value = uint8_t(tmp_color.dev_alpha() * 255.0f);
                        break;
                    case mm::PIXFMT_G1:
                    case mm::PIXFMT_G2:
                    case mm::PIXFMT_G4:
                    case mm::PIXFMT_G8:
                        p_color->value = uint8_t(tmp_color.hsl_lightness() * 255.0f);
                        break;
                    case mm::PIXFMT_RGB888:
                    case mm::PIXFMT_BGR888:
                        p_color->value = tmp_color.rgb24();
                        break;
                    case mm::PIXFMT_RGBA8888:
                    case mm::PIXFMT_BGRA8888:
                        p_color->value = tmp_color.dev_rgba32();
                        break;
                    case mm::PIXFMT_PRGBA8888:
                    case mm::PIXFMT_PBGRA8888:
                        p_color->value = tmp_color.prgba32();
                        break;
                    default:
                        p_color->value = tmp_color.dev_rgba32();
                        break;
                }
            }

            // Initialize temporary bitmap for loading
            Bitmap tmp;
            if ((res = tmp.init(img_pixfmt, hdr.width, hdr.height)) != STATUS_OK)
                return res;

            // Do the read & conversion
            {
                const size_t row_size = hdr.width * hdr.chars_per_pixel;
                char *buf = static_cast<char *>(malloc(row_size + hdr.chars_per_pixel + 1));
                if (buf == NULL)
                    return STATUS_NO_MEM;
                lsp_finally { free(buf); };

                char *id = &buf[row_size];
                id[hdr.chars_per_pixel] = '\0';

                // read and convert line
                for (size_t i=0; i<hdr.height; ++i)
                {
                    // Read line
                    uint8_t *dst    = tmp.row(i);
                    if ((res = parser->read_line(buf)) != STATUS_OK)
                        return (res == STATUS_NOT_FOUND) ? STATUS_CORRUPTED_FILE : res;

                    // Convert row data
                    for (size_t j=0; j<row_size; ++j)
                    {
                        // Collect the color identifier
                        const size_t off = j % hdr.chars_per_pixel;
                        id[off] = buf[j];
                        if (off != hdr.chars_per_pixel - 1)
                            continue;

                        // Fetch color from palette
                        const xpm_color_t *xcol = palette.get(id);
                        if (xcol == NULL)
                            return STATUS_CORRUPTED_FILE;
                        const uint32_t c = xcol->value;

                        // Emit color pixel to the output image
                        switch (img_pixfmt)
                        {
                            case mm::PIXFMT_A1:
                            case mm::PIXFMT_A2:
                            case mm::PIXFMT_A4:
                            case mm::PIXFMT_A8:
                            case mm::PIXFMT_G1:
                            case mm::PIXFMT_G2:
                            case mm::PIXFMT_G4:
                            case mm::PIXFMT_G8:
                                *(dst++)    = uint8_t(c);
                                break;
                            case mm::PIXFMT_RGB888:
                                dst[0]      = uint8_t(c >> 16);
                                dst[1]      = uint8_t(c >> 8);
                                dst[2]      = uint8_t(c);
                                dst        += 3;
                                break;
                            case mm::PIXFMT_BGR888:
                                dst[0]      = uint8_t(c);
                                dst[1]      = uint8_t(c >> 8);
                                dst[2]      = uint8_t(c >> 16);
                                dst        += 3;
                                break;
                            case mm::PIXFMT_RGBA8888:
                            case mm::PIXFMT_PRGBA8888:
                                dst[0]      = uint8_t(c >> 16);
                                dst[1]      = uint8_t(c >> 8);
                                dst[2]      = uint8_t(c);
                                dst[3]      = uint8_t(c >> 24);
                                dst        += 4;
                                break;
                            case mm::PIXFMT_BGRA8888:
                            case mm::PIXFMT_PBGRA8888:
                            default:
                                dst[0]      = uint8_t(c);
                                dst[1]      = uint8_t(c >> 8);
                                dst[2]      = uint8_t(c >> 16);
                                dst[3]      = uint8_t(c >> 24);
                                dst        += 4;
                                break;
                        }
                    }
                }
            }

            // Free color palette
            free_xpm_colors(palette);

            // Close parser
            if ((res = parser->close()) != STATUS_OK)
                return res;
            delete parser;
            parser = NULL;

            // Convert bitmap if necessary
            if (img_pixfmt != format)
            {
                if ((res = tmp.convert(format)) != STATUS_OK)
                    return res;
            }

            // Commit result
            tmp.swap(this);

            return STATUS_OK;
        }

    } /* namespace mm */
} /* namespace lsp */


#endif /* PRIVATE_MM_BITMAP_XPM_H_ */
