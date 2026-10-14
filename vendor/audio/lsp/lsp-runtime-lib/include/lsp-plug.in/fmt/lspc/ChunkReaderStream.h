/*
 * Copyright (C) 2022 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2022 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 21 окт. 2022 г.
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

#ifndef LSP_PLUG_IN_FMT_LSPC_CHUNKREADERSTREAM_H_
#define LSP_PLUG_IN_FMT_LSPC_CHUNKREADERSTREAM_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/io/IInStream.h>

namespace lsp
{
    namespace lspc
    {
        class ChunkReader;

        class ChunkReaderStream: public io::IInStream
        {
            private:
                ChunkReaderStream & operator = (const ChunkReaderStream &);

            private:
                ChunkReader        *pReader;
                bool                bDelete;

            private:
                void            do_close();

            public:
                ChunkReaderStream(ChunkReader *reader, bool free = false);
                virtual ~ChunkReaderStream();

            public:
                virtual wssize_t    position() override;
                virtual ssize_t     read_byte() override;
                virtual ssize_t     read(void *dst, size_t count) override;
                virtual wssize_t    skip(wsize_t amount) override;
                virtual status_t    close() override;
        };

    } /* namespace lspc */
} /* namespace lsp */

// Definition of lsp::lspc::ChunkReader
#include <lsp-plug.in/fmt/lspc/ChunkReader.h>


#endif /* LSP_PLUG_IN_FMT_LSPC_CHUNKREADERSTREAM_H_ */
