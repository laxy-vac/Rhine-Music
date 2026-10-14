/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 23 июл. 2025 г.
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

#ifndef LSP_PLUG_IN_FMT_OBJ_COMPRESSOR_H_
#define LSP_PLUG_IN_FMT_OBJ_COMPRESSOR_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/io/File.h>
#include <lsp-plug.in/io/IOutStream.h>
#include <lsp-plug.in/io/OutBitStream.h>

#include <lsp-plug.in/fmt/obj/const.h>
#include <lsp-plug.in/fmt/obj/IObjHandler.h>

namespace lsp
{
    namespace obj
    {
        /**
         * OBJ format compressor
         */
        class Compressor: public IObjHandler
        {
            protected:
                io::OutBitStream   *pOut;

                union
                {
                    float              *vFloatBuf;
                    uint32_t           *vIntBuf;
                };

                uint32_t            nFloatHead;
                uint32_t            nFloatSize;
                uint32_t            nFloatCap;
                uint32_t            nFloatBits;

                uint32_t            nLastEvent;

                size_t              nWFlags;

            protected:
                status_t            do_wrap(io::OutBitStream * & obs, size_t flags = WRAP_CLOSE | WRAP_DELETE);
                status_t            write_varint(size_t value);
                status_t            write_varint_icount(size_t value);
                status_t            write_float(float value);
                inline status_t     write_indices(const index_t *value, size_t count);
                inline status_t     write_event(uint32_t event);
                inline status_t     write_utf8(const char *text);
                static bool         has_nonempty_index(const index_t *v, size_t count);
                static bool         has_equal_indices(const index_t *v, size_t count);

            public:
                Compressor();
                Compressor(const Compressor &) = delete;
                Compressor(Compressor &&) = delete;
                virtual ~Compressor() override;

                Compressor & operator = (const Compressor &) = delete;
                Compressor & operator = (Compressor &&) = delete;

            public:
                status_t            open(const char *path, size_t mode);
                status_t            open(const LSPString *path, size_t mode);
                status_t            open(const io::Path *path, size_t mode);

                status_t            wrap(FILE *fd, bool close);
                status_t            wrap_native(fhandle_t fd, bool close);
                status_t            wrap(io::File *fd, size_t flags = 0);
                status_t            wrap(io::IOutStream *os, size_t flags = 0);
                status_t            wrap(io::OutBitStream *obs, size_t flags = 0);

                status_t            close();

            public:
                /**
                 * Set buffer size
                 * @param float_bits number of bits to encode floating-point number (and logarithm of the buffer size)
                 * @return status of operation
                 */
                status_t            set_buffer_size(size_t float_bits);

            public:
                virtual status_t    begin_object(const char *name) override;
                virtual status_t    begin_object(const LSPString *name) override;
                virtual status_t    end_object() override;
                virtual status_t    end_of_data() override;
                virtual ssize_t     add_vertex(float x, float y, float z, float w) override;
                virtual ssize_t     add_param_vertex(float x, float y, float z, float w) override;
                virtual ssize_t     add_normal(float nx, float ny, float nz, float nw) override;
                virtual ssize_t     add_texture_vertex(float u, float v, float w) override;
                virtual ssize_t     add_face(const index_t *vv, const index_t *vn, const index_t *vt, size_t n) override;
                virtual ssize_t     add_points(const index_t *vv, size_t n) override;
                virtual ssize_t     add_line(const index_t *vv, const index_t *vt, size_t n) override;
        };

    } /* namespace obj */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_FMT_OBJ_COMPRESSOR_H_ */
