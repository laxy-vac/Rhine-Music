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

#ifndef LSP_PLUG_IN_MM_BITMAP_H_
#define LSP_PLUG_IN_MM_BITMAP_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/io/IInStream.h>
#include <lsp-plug.in/mm/pixel.h>
#include <lsp-plug.in/mm/IColorMap.h>
#include <lsp-plug.in/runtime/LSPString.h>

namespace lsp
{
    namespace mm
    {
        /**
         * Bitmap class, simple raster bitmap storage
         */
        class Bitmap
        {
            private:
                uint8_t        *pData;
                size_t          nWidth;
                size_t          nHeight;
                size_t          nStride;
                pixel_format_t  enFormat;

            private:
                status_t                do_load(io::IInStream *is, pixel_format_t format, IColorMap *map);
                status_t                load_xpm(io::IInStream *is, pixel_format_t format, IColorMap *map);
                static inline size_t    calc_bytes_per_row(pixel_format_t format, size_t cols) noexcept;
                static inline size_t    calc_stride(pixel_format_t format, size_t cols) noexcept;

            public:
                Bitmap() noexcept;
                Bitmap(const Bitmap &);
                Bitmap(const Bitmap *);
                Bitmap(Bitmap && src) noexcept;
                ~Bitmap();

                Bitmap & operator = (const Bitmap & src);
                Bitmap & operator = (const Bitmap * src);
                Bitmap & operator = (Bitmap && src) noexcept;

                void swap(Bitmap & src) noexcept;
                void swap(Bitmap * src) noexcept;

            public:
                /**
                 * Get pixel format of the bitmap
                 * @return pixel format
                 */
                inline pixel_format_t format() const noexcept           { return enFormat;  }

                /**
                 * Get number of rows
                 * @return number of rows
                 */
                inline size_t rows() const noexcept                     { return nHeight;   }

                /**
                 * Get bitmap width
                 * @return bitmap width in pixels
                 */
                inline size_t width() const noexcept                    { return nWidth;     }

                /**
                 * Get number of columns
                 * @return number of columns
                 */
                inline size_t columns() const noexcept                  { return nWidth;     }

                /**
                 * Get bitmap height
                 * @return bitmap height in pixels
                 */
                inline size_t height() const noexcept                   { return nHeight;     }

                /**
                 * Get number of bytes per each row
                 * @return number of bytes per each row
                 */
                inline size_t stride() const noexcept                   { return nStride;   }

                /**
                 * Get number of bytes per each row
                 * @return number of bytes per each row
                 */
                inline size_t bytes_per_row() const noexcept            { return nStride;   }

                /**
                 * Get row of the bitmap
                 * @param index number of row
                 * @return pointer to row or NULL
                 */
                inline uint8_t *row(size_t index) noexcept              { return ((pData != NULL) && (index < nHeight)) ? &pData[nStride * index] : NULL; }

                /**
                 * Get row of the bitmap
                 * @param index number of row
                 * @return pointer to row or NULL
                 */
                inline const uint8_t *row(size_t index) const noexcept  { return ((pData != NULL) && (index < nHeight)) ? &pData[nStride * index] : NULL; }

                /**
                 * Get the full bitmap data
                 * @return full bitmap data
                 */
                inline uint8_t *data() noexcept                         { return pData; }

                /**
                 * Get the full bitmap data
                 * @return full bitmap data
                 */
                inline const uint8_t *data() const noexcept             { return pData; }

                /**
                 * Check that bitmap is empty
                 * @return true if bitmap is empty
                 */
                inline bool is_empty() const noexcept                   { return pData == NULL; }

            public:
                /**
                 * Initialize bitmap
                 * @param format pixel format of bitmap
                 * @param width image width
                 * @param height image height
                 * @return status of operation
                 */
                status_t init(pixel_format_t format, size_t width, size_t height);

                /**
                 * Set bitmap data
                 * @param src source bitmap
                 * @return status of operation
                 */
                status_t set(const Bitmap & src);

                /**
                 * Set bitmap data
                 * @param src source bitmap
                 * @return status of operation
                 */
                status_t set(const Bitmap * src);

                /**
                 * Reset bitmap content
                 */
                void reset();

                /**
                 * Resize bitmap. The stored image does not scale, it becomes cropped if new size is smaller.
                 *
                 * @param width image width
                 * @param height image height
                 * @return status of operation
                 */
                status_t resize(size_t width, size_t height);

                /**
                 * Convert bitmap to desired pixel format
                 * @param format desired pixel format
                 * @return status of operation
                 */
                status_t convert(pixel_format_t format);

                /**
                 * Convert bitmap to desired pixel format and store to new bitmap
                 * @param dst destination bitmap to store result
                 * @param format desired pixel format
                 * @return status of operation
                 */
                status_t convert_to(Bitmap & dst, pixel_format_t format) const;

                /**
                 * Convert bitmap to desired pixel format and store to new bitmap
                 * @param dst destination bitmap to store result
                 * @param format desired pixel format
                 * @return status of operation
                 */
                status_t convert_to(Bitmap *dst, pixel_format_t format) const;

                /**
                 * Convert source bitmap to desired pixel format and store to this bitmap
                 * @param src source bitmap
                 * @param format desired pixel format
                 * @return status of operation
                 */
                status_t convert_from(const Bitmap & src, pixel_format_t format);

                /**
                 * Convert source bitmap to desired pixel format and store to this bitmap
                 * @param src source bitmap
                 * @param format desired pixel format
                 * @return status of operation
                 */
                status_t convert_from(const Bitmap * src, pixel_format_t format);

                /**
                 * Load bitmap from file
                 * @param path path to the file
                 * @param format desired pixel format (optional)
                 * @param map color map (optional)
                 * @return status of operation
                 */
                status_t load(const char *path, pixel_format_t format = PIXFMT_DEFAULT, IColorMap *map = NULL);

                /**
                 * Load bitmap from file
                 * @param path path to the file
                 * @param format desired pixel format (optional)
                 * @param map color map (optional)
                 * @return status of operation
                 */
                status_t load(const LSPString *path, pixel_format_t format = PIXFMT_DEFAULT, IColorMap *map = NULL);

                /**
                 * Load bitmap from file
                 * @param path path to the file
                 * @param format desired pixel format (optional)
                 * @param map color map (optional)
                 * @return status of operation
                 */
                status_t load(const LSPString & path, pixel_format_t format = PIXFMT_DEFAULT, IColorMap *map = NULL);

                /**
                 * Load bitmap from file
                 * @param path path to the file
                 * @param format desired pixel format (optional)
                 * @param map color map (optional)
                 * @return status of operation
                 */
                status_t load(const io::Path *path, pixel_format_t format = PIXFMT_DEFAULT, IColorMap *map = NULL);

                /**
                 * Load bitmap from memory chunk
                 * @param data memory chunk data
                 * @param size size of memory chunk
                 * @param format desired pixel format (optional)
                 * @param map color map (optional)
                 * @return status of operation
                 */
                status_t load(const void *data, size_t size, pixel_format_t format = PIXFMT_DEFAULT, IColorMap *map = NULL);

                /**
                 * Load bitmap from file
                 * @param path path to the file
                 * @param format desired pixel format (optional)
                 * @param map color map (optional)
                 * @return status of operation
                 */
                status_t load(const io::Path & path, pixel_format_t format = PIXFMT_DEFAULT, IColorMap *map = NULL);

                /**
                 * Load bitmap from input stream
                 * @param is input stream
                 * @param format desired pixel format (optional)
                 * @param map color map (optional)
                 * @return status of operation
                 */
                status_t load(io::IInStream *is, pixel_format_t format = PIXFMT_DEFAULT, IColorMap *map = NULL);
        };

    } /* namespace mm */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_MM_BITMAP_H_ */
