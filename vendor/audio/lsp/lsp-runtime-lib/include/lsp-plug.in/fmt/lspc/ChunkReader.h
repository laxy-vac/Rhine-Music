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

#ifndef LSP_PLUG_IN_FMT_LSPC_CHUNKREADER_H_
#define LSP_PLUG_IN_FMT_LSPC_CHUNKREADER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/fmt/lspc/ChunkAccessor.h>
#include <lsp-plug.in/fmt/lspc/ChunkReaderStream.h>

namespace lsp
{
    namespace lspc
    {
        class ChunkReader: public ChunkAccessor
        {
            private:
                ChunkReader & operator = (const ChunkReader &);

            protected:
                friend class File;

            protected:
                uint32_t            nUnread;            // Number of bytes still not read from chunk
                size_t              nBufTail;           // Buffer tail
                wsize_t             nFileOff;           // File read offset
                wssize_t            nPosition;          // Actual read position
                bool                bLast;              // Indicator of the last chunk
                ChunkReaderStream   sStream;            // The stream interface

            protected:
                explicit ChunkReader(Resource *fd, uint32_t magic, uint32_t uid);

            public:
                virtual ~ChunkReader();

            public:
                /**
                 * Obtain access to chunk reader as a stream.
                 * @return pointer to the stream
                 */
                inline io::IInStream   *stream()            { return &sStream;      }

                /**
                 * Get current read position in bytes
                 * @return actual position from the beginning of the chunk including header
                 */
                inline wssize_t         position() const    { return nPosition;     }

            public:
                /**
                 * Read chunk data header from LSPC chunk. Header should contain lspc_header_t at
                 * the beginning.
                 * @param hdr the header data to store
                 * @param size the size of header, should be at least sizeof(lspc_header_t)
                 * @return status of operation or error code (negative)
                 */
                virtual ssize_t     read_header(void *hdr, size_t size);
    
                /**
                 * Read regular data from LSPC chunk.
                 * @param buf the pointer to store data
                 * @param count number of bytes to read
                 * @return number of bytes read or error code (negative)
                 */
                virtual ssize_t     read(void *buf, size_t count);

                /**
                 * Skip some amount of data
                 * @param count amount of bytes to skip
                 * @return number of skipped bytes or error code (negative)
                 */
                virtual ssize_t     skip(size_t count);
        };
    }

} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_LSPC_CHUNKREADER_H_ */
