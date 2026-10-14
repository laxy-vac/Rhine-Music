/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 26 июл. 2025 г.
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

#ifndef LSP_PLUG_IN_FMT_OBJ_DECOMPRESSOR_H_
#define LSP_PLUG_IN_FMT_OBJ_DECOMPRESSOR_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/fmt/obj/const.h>
#include <lsp-plug.in/fmt/obj/PullParser.h>
#include <lsp-plug.in/fmt/obj/IObjHandler.h>
#include <lsp-plug.in/io/InBitStream.h>

namespace lsp
{
    namespace obj
    {

        class Decompressor
        {
            protected:
                io::InBitStream     sStream;
                union
                {
                    float              *vFloatBuf;
                    uint32_t           *vIntBuf;
                };

                uint32_t            nFloatHead;
                uint32_t            nFloatSize;
                uint32_t            nFloatCap;
                uint32_t            nFloatBits;

                compressed_event_type_t nLastEvent;

            protected:
                status_t            parse_data(IObjHandler *handler);
                status_t            parse_header();
                void                clear_state();
                status_t            read_event(compressed_event_type_t *event);
                status_t            parse_vertex(IObjHandler *handler, size_t coords);
                status_t            parse_pvertex(IObjHandler *handler, size_t coords);
                status_t            parse_normal(IObjHandler *handler, size_t coords);
                status_t            parse_texcoord(IObjHandler *handler, size_t coords);
                status_t            parse_face(IObjHandler *handler, bool texcoords, bool normals, bool fill);
                status_t            parse_line(IObjHandler *handler, bool texcoords);
                status_t            parse_points(IObjHandler *handler);
                status_t            parse_object(IObjHandler *handler);
                status_t            read_float(float *dst);
                status_t            read_varint(size_t *dst);
                status_t            read_varint_icount(size_t *dst);
                status_t            read_indices(index_t *dst, size_t count, bool read);
                status_t            read_utf8(LSPString *dst);

            public:
                explicit Decompressor();
                Decompressor(const Decompressor &) = delete;
                Decompressor(Decompressor &&) = delete;
                virtual ~Decompressor();

                Decompressor & operator = (const Decompressor &) = delete;
                Decompressor & operator = (Decompressor &&) = delete;

            public:
                /**
                 * Parse compressed OBJ file
                 * @param handler Wavefront Object file handler
                 * @param path UTF-8 path to the file
                 * @return status of operation
                 */
                status_t            parse_file(IObjHandler *handler, const char *path);

                /**
                 * Parse compressed OBJ file
                 * @param handler Wavefront Object file handler
                 * @param path path to the file
                 * @return status of operation
                 */
                status_t            parse_file(IObjHandler *handler, const LSPString *path);

                /**
                 * Parse compressed OBJ file
                 * @param handler Wavefront Object file handler
                 * @param path path to the file
                 * @return status of operation
                 */
                status_t            parse_file(IObjHandler *handler, const io::Path *path);

                /**
                 * Parse compressed OBJ data from input stream
                 * @param handler Wavefront Object file handler
                 * @param is input stream
                 * @param flags wrap flags
                 * @return status of operation
                 */
                status_t            parse_data(IObjHandler *handler, io::IInStream *is, size_t flags = WRAP_NONE);

                /**
                 * Parse compressed OBJ data from memory
                 * @param handler Wavefront Object file handler
                 * @param data byte buffer
                 * @param size size of byte buffer
                 * @return status of operation
                 */
                status_t            parse_data(IObjHandler *handler, const void *data, size_t size);
        };

    } /* namespace obj */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_FMT_OBJ_DECOMPRESSOR_H_ */
