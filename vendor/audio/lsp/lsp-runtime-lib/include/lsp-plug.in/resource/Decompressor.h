/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 16 мар. 2021 г.
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

#ifndef LSP_PLUG_IN_RESOURCE_DECOMPRESSOR_H_
#define LSP_PLUG_IN_RESOURCE_DECOMPRESSOR_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/io/IInStream.h>
#include <lsp-plug.in/io/InBitStream.h>
#include <lsp-plug.in/resource/buffer.h>

namespace lsp
{
    namespace resource
    {
        class Decompressor: public io::IInStream
        {
            protected:
                typedef struct cbuf_t
                {
                    uint8_t        *data;           // Data
                    size_t          off;            // Offset
                    size_t          size;           // Size of buffer
                    size_t          cap;            // Capacity of buffer
                    size_t          rep;            // Number of repeats
                } cbuf_t;

            protected:
                io::InBitStream     sIn;            // Input stream
                dbuffer_t           sBuffer;        // Buffer for caching
                cbuf_t              sReplay;        // Replay buffer

                size_t              nOffset;        // Offset
                size_t              nSize;          // Decompressed size

            protected:
                status_t            read_uint(size_t *out, size_t initial, size_t stepping);
                size_t              get_buf(uint8_t *dst, size_t count);
                ssize_t             get_bufc();
                status_t            set_buf(size_t off, size_t count, size_t rep);
                status_t            set_bufc(uint8_t c, size_t rep);
                status_t            fill_buf();
                status_t            do_close();

            public:
                explicit Decompressor();
                Decompressor(const Decompressor &) = delete;
                Decompressor(Decompressor &&) = delete;
                Decompressor & operator = (const Decompressor &) = delete;
                Decompressor & operator = (Decompressor &&) = delete;

                virtual ~Decompressor() override;

            public:
                /**
                 * Initialize decompressor
                 * @param data binary data
                 * @param data_size the size of the binary data
                 * @param decompressed_size the size of the decompressed data
                 * @param buf_sz I/O buffer size (the exponent for power-of-two value)
                 * @return status of operation
                 */
                status_t            init(const void *data, size_t data_size, size_t decompressed_size, size_t log_buf_sz);

            public: // io::IInStream
                virtual wssize_t    position() override;
                virtual ssize_t     read_byte() override;
                virtual ssize_t     read(void *dst, size_t count) override;
                virtual status_t    close() override;
        };
    } /* namespace resource */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_RESOURCE_DECOMPRESSOR_H_ */
