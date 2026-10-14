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

#ifndef LSP_PLUG_IN_FMT_LSPC_CHUNKACCESSOR_H_
#define LSP_PLUG_IN_FMT_LSPC_CHUNKACCESSOR_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/fmt/lspc/lspc.h>
#include <lsp-plug.in/stdlib/stdio.h>

namespace lsp
{
    namespace lspc
    {
        typedef struct Resource
        {
            fhandle_t       fd;             // File handle
            size_t          refs;           // Number of references
            size_t          bufsize;        // Default buffer size
            uint32_t        chunk_id;       // Chunk identifier allocator
            wsize_t         length;         // Length of the output file

            status_t        acquire();
            status_t        release();
            status_t        allocate(uint32_t *id);
            status_t        write(const void *buf, size_t count);
            ssize_t         read(wsize_t pos, void *buf, size_t count);
        } Resource;

        class ChunkAccessor
        {
            protected:
                friend class File;

            protected:
                enum const_t
                {
                    MIN_BUF_SIZE        = 0x1000
                };

            protected:
                uint8_t        *pBuffer;        // Pointer to the buffer
                size_t          nBufSize;       // Size of the buffer
                size_t          nBufPos;        // Current buffer position
                Resource       *pFile;          // Pointer to the shared file resource
                uint32_t        nMagic;         // Magic number as size of chunk
                status_t        nErrorCode;     // Last error code
                chunk_id_t      nUID;           // Unique chunk identifier

            protected:
                inline status_t set_error(status_t err)     { return nErrorCode = err; }
                status_t        do_close();

            protected:
                explicit ChunkAccessor(Resource *fd, uint32_t magic);

            public:
                ChunkAccessor(const ChunkAccessor &) = delete;
                ChunkAccessor(ChunkAccessor &&) = delete;
                virtual ~ChunkAccessor();

                ChunkAccessor & operator = (const ChunkAccessor &) = delete;
                ChunkAccessor & operator = (ChunkAccessor &&) = delete;

            public:
                inline size_t       buffer_size() const     { return nBufSize;      }
                inline status_t     last_error() const      { return nErrorCode;    }
                inline chunk_id_t   unique_id() const       { return nUID;          }
                inline uint32_t     magic() const           { return nMagic;        }

            public:
                /** Close chunk accessor
                 *
                 * @return status of operation
                 */
                virtual status_t    close();
        };

    } /* namespace lspc */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_LSPC_CHUNKACCESSOR_H_ */
