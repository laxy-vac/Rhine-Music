/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 13 мар. 2021 г.
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

#ifndef LSP_PLUG_IN_RESOURCE_BUFFER_H_
#define LSP_PLUG_IN_RESOURCE_BUFFER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>

namespace lsp
{
    namespace resource
    {
        /**
         * The maximum number of characters appended to the replay buffer
         * if the character repeat at the tail is used.
         */
        static const size_t REPEAT_BUF_MAX          = 4;

        /**
         * Location in the buffer
         */
        typedef struct location_t
        {
            ssize_t     offset;     // Offset relative to the buffer
            size_t      len;        // Length of the block
            size_t      repeat;     // Number of repeats
        } location_t;

        /**
         * Compression buffer
         */
        typedef struct cbuffer_t
        {
            public:
                uint8_t    *data;       // Buffer data (2 x capacity)
                uint32_t   *index;      // Index
                uint32_t   *root;       // Root index
                uint32_t    head;       // Head of the buffer
                uint32_t    length;     // Buffer length
                uint32_t    cap;        // Buffer capacity

            public:
                explicit cbuffer_t();
                ~cbuffer_t();

                status_t        init(size_t log_capacity);
                void            destroy();

            public:
                /**
                 * Append buffer to compression buffer
                 * @param src buffer to append
                 * @param count the length of the buffer to append
                 */
                void            append(const void *src, size_t count);

                /**
                 * Append single byte to compression buffer
                 * @param v byte to append
                 */
                void            append(uint8_t v);

                /**
                 * Lookup for byte sequence inside of the buffer
                 * @param out relative offset of the sub-sequence in the buffer to the last byte stored in the buffer
                 * @param src byte sequence to search inside of the buffer
                 * @param avail number of bytes available in the sequence
                 * @return the length of sub-sequence found in the buffer
                 */
                size_t          lookup(size_t *out, const void *src, size_t avail);

                /**
                 * Get byte relative to the last written byte
                 * @param offset offset relative to the last written byte
                 * @return byte
                 */
                uint8_t         byte_at(size_t offset);

                /**
                 * Cleanup state of the buffer
                 */
                void            clear();

                /**
                 * Get size of data currently stored in the buffer
                 * @return size of data currently stored in the buffer
                 */
                inline size_t   size() const { return lsp_min(length, cap); }

        } cbuffer_t;

        /**
         * Decompression buffer
         */
        typedef struct dbuffer_t
        {
            public:
                uint8_t    *data;       // Buffer data (2 x capacity)
                uint32_t    length;     // Actual size of buffer
                uint32_t    head;       // Head of the buffer
                uint32_t    cap;        // Buffer capacity, power of two

            public:
                explicit dbuffer_t();
                ~dbuffer_t();

                status_t        init(size_t log_capacity);
                void            destroy();

            public:
                /**
                 * Extract data from buffer
                 * @param dst destination pointer to store result
                 * @param offset relative offset of the subsequence in the buffer to the last byte store in the buffer
                 * @param count number of bytes to extract
                 * @return status of operation (error on buffer underflow)
                 */
                status_t        extract(void *dst, size_t offset, size_t count);

                /**
                 * Append multiple bytes to the buffer
                 * @param src data to append to the buffer
                 * @param count number of bytes to append
                 */
                void            append(const void *src, size_t count);

                /**
                 * Append single byte to the buffer
                 * @param v byt to append
                 */
                void            append(uint8_t v);

                /**
                 * Clear buffer state
                 */
                void            clear();

                /**
                 * Get size of data currently stored in the buffer
                 * @return size of data currently stored in the buffer
                 */
                inline size_t   size() const { return length; }

        } duffer_t;

    } /* namespace resource */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_RESOURCE_BUFFER_H_ */
