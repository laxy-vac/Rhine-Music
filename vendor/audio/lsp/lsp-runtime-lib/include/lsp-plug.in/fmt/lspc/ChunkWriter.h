/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 14 янв. 2018 г.
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

#ifndef LSP_PLUG_IN_FMT_LSPC_CHUNKWRITER_H_
#define LSP_PLUG_IN_FMT_LSPC_CHUNKWRITER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/fmt/lspc/ChunkAccessor.h>
#include <lsp-plug.in/fmt/lspc/ChunkWriterStream.h>
#include <lsp-plug.in/fmt/lspc/lspc.h>

namespace lsp
{
    namespace lspc
    {
        class ChunkWriter: public ChunkAccessor
        {
            private:
                ChunkWriter & operator = (const ChunkWriter &);

            protected:
                friend class File;

                enum flush_t
                {
                    F_FORCE         = 1 << 0,
                    F_LAST          = 1 << 1
                };

            protected:
                size_t              nChunksOut;
                wssize_t            nPosition;
                ChunkWriterStream   sStream;

            protected:
                status_t            do_flush(size_t flags);

            protected:
                explicit ChunkWriter(Resource *fd, uint32_t magic);
    
            public:
                virtual ~ChunkWriter();

            public:
                /**
                 * Obtain access to chunk writer as a stream.
                 * @return pointer to the stream
                 */
                inline io::IOutStream  *stream()            { return &sStream;      }

                /**
                 * Get current write position in bytes
                 * @return actual position from the beginning of the chunk including header
                 */
                inline wssize_t         position() const    { return nPosition;     }

            public:
                /**
                 * Write chunk data header to LSPC chunk.
                 * @param buf buffer containing header
                 * @return status of operation
                 */
                virtual status_t    write_header(const void *buf);

                /**
                 * Write data to LSPC chunk
                 * @param buf buffer to write
                 * @param count number of bytes to write
                 * @return status of operation
                 */
                virtual status_t    write(const void *buf, size_t count);

                /**
                 * Flush all buffers to file
                 * @return status of operation
                 */
                virtual status_t    flush();

                /**
                 * Close chunk writer
                 * @return status of operation
                 */
                virtual status_t    close();
        };
    }

} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_LSPC_CHUNKWRITER_H_ */
