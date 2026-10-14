/*
 * Copyright (C) 2022 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2022 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 20 окт. 2022 г.
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

#ifndef LSP_PLUG_IN_FMT_LSPC_CHUNKWRITERSTREAM_H_
#define LSP_PLUG_IN_FMT_LSPC_CHUNKWRITERSTREAM_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/io/IOutStream.h>

namespace lsp
{
    namespace lspc
    {
        class ChunkWriter;

        class ChunkWriterStream: public io::IOutStream
        {
            private:
                ChunkWriterStream & operator = (const ChunkWriterStream &);

            private:
                ChunkWriter    *pWriter;
                bool            bDelete;

            private:
                void            do_close();

            public:
                ChunkWriterStream(ChunkWriter *writer, bool free = false);
                virtual ~ChunkWriterStream();

            public:
                virtual wssize_t    position() override;
                virtual ssize_t     write(const void *buf, size_t count) override;
                virtual ssize_t     writeb(int v) override;
                virtual status_t    flush() override;
                virtual status_t    close() override;
        };

    } /* namespace lspc */
} /* namespace lsp */

// Definition of lsp::lspc::ChunkWriter
#include <lsp-plug.in/fmt/lspc/ChunkWriter.h>

#endif /* LSP_PLUG_IN_FMT_LSPC_CHUNKWRITERSTREAM_H_ */
