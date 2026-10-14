/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 25 янв. 2026 г.
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

#ifndef LSP_PLUG_IN_MM_PIXEL_H_
#define LSP_PLUG_IN_MM_PIXEL_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/types.h>

namespace lsp
{
    namespace mm
    {
        enum pixel_format_t
        {
            PIXFMT_DEFAULT,         /* Default pixel format     */
            PIXFMT_G1,              /* 1 bit per pixel, gray    */
            PIXFMT_G2,              /* 2 bits per pixel, gray   */
            PIXFMT_G4,              /* 4 bits per pixel, gray   */
            PIXFMT_G8,              /* 8 bits per pixel, gray   */
            PIXFMT_A1,              /* 1 bit per pixel, alpha   */
            PIXFMT_A2,              /* 2 bits per pixel, alpha  */
            PIXFMT_A4,              /* 4 bits per pixel, alpha  */
            PIXFMT_A8,              /* 8 bits per pixel, alpha  */
            PIXFMT_RGB888,          /* RGB: 8 bits per each component */
            PIXFMT_BGR888,          /* BGR: 8 bits per each component */
            PIXFMT_RGBA8888,        /* RGBA: 8 bits per each component */
            PIXFMT_BGRA8888,        /* BGRA: 8 bits per each component */
            PIXFMT_PRGBA8888,       /* PRGBA: 8 bits per each component */
            PIXFMT_PBGRA8888,       /* PRGBA: 8 bits per each component */
        };

        /**
         * Pixel conversion function
         * @param dst desination buffer to store data
         * @param src source buffer to read data
         * @param count number of pixels to convert
         */
        typedef void (*pixel_conversion_t)(uint8_t *dst, const uint8_t *src, size_t count);

        /**
         * Get number of bits used to represent a pixel
         * @param format pixel format
         * @return number of bits used to represent a pixel
         */
        size_t  bits_per_pixel(pixel_format_t format) noexcept;

        /**
         * Get actual number of bits used to represent a pixel on a device
         * @param format pixel format
         * @return number of bits used to represent a pixel
         */
        size_t  device_bits_per_pixel(pixel_format_t format) noexcept;

        /**
         * Get pixel format name
         * @param format pixel format
         * @return pixel format name
         */
        const char *pixel_format_name(pixel_format_t format) noexcept;

        /**
         * Check that pixels of format dst have the same representation in memory
         * and do not need conversion from format src
         * @param dst destination pixel format
         * @param src source pixel format
         * @return true if there is no conversion needed
         */
        bool is_exact_copy_of_pixel(pixel_format_t dst, pixel_format_t src) noexcept;

        /**
         * Perform conversion between different pixel formats.
         *
         * @param dst desination buffer to store data
         * @param src source buffer to read data
         * @param dst_fmt destination pixel format
         * @param src_fmt source pixel format
         * @param count number of pixels to convert
         */
        void convert_pixels(uint8_t *dst, const uint8_t *src, pixel_format_t dst_fmt, pixel_format_t src_fmt, size_t count) noexcept;

        /**
         * Get pixel conversion function.
         *
         * @param dst_fmt destination pixel format
         * @param src_fmt source pixel format
         * @return pixel conversion function or NULL if no conversion is needed (@see is_exact_copy_of_pixel).
         */
        pixel_conversion_t pixel_convert_function(pixel_format_t dst_fmt, pixel_format_t src_fmt) noexcept;

    } /* namespace mm */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_MM_PIXEL_H_ */
