/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
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

#ifndef LSP_PLUG_IN_FMT_LSPC_FILE_H_
#define LSP_PLUG_IN_FMT_LSPC_FILE_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/fmt/lspc/ChunkReader.h>
#include <lsp-plug.in/fmt/lspc/ChunkWriter.h>
#include <lsp-plug.in/io/Path.h>

namespace lsp
{
    namespace lspc
    {
        class File
        {
            protected:
                friend class ChunkReader;
                friend class ChunkWriter;

            protected:
                Resource           *pFile;      // Shared resource
                bool                bWrite;     // Read/Write mode
                size_t              nHdrSize;   // Size of header

            protected:
                Resource       *create_resource(fhandle_t fd);

            public:
                explicit File();
                File(const File &) = delete;
                File(File &&) = delete;
                virtual ~File();

                File & operator = (const File &) = delete;
                File & operator = (File &&) = delete;

            public:
                /** Open file for reading
                 *
                 * @param path location of the file
                 * @return status of operation
                 */
                status_t    open(const char *path);

                /** Open file for reading
                 *
                 * @param path location of the file
                 * @return status of operation
                 */
                status_t    open(const LSPString *path);

                /** Open file for reading
                 *
                 * @param path location of the file
                 * @return status of operation
                 */
                status_t    open(const io::Path *path);

                /** Open file for writing
                 *
                 * @param path location of the file
                 * @return status of operation
                 */
                status_t    create(const char *path);

                /** Open file for reading
                 *
                 * @param path location of the file
                 * @return status of operation
                 */
                status_t    create(const LSPString *path);

                /** Open file for reading
                 *
                 * @param path location of the file
                 * @return status of operation
                 */
                status_t    create(const io::Path *path);

                /** Close the file
                 *
                 * @return status of operation
                 */
                status_t    close();

            public:
                /** Write chunk
                 *
                 * @param magic magic number of the chunk type
                 * @return pointer to chunk writer
                 */
                ChunkWriter     *write_chunk(uint32_t magic);

                /** Read chunk
                 *
                 * @param uid magic number of the chunk type
                 * @return pointer to chunk reader
                 */
                ChunkReader     *read_chunk(uint32_t uid);

                /** Read chunk of specific type
                 *
                 * @param uid unique chunk identifier
                 * @param magic magic number of the chunk type
                 * @return pointer to chunk reader
                 */
                ChunkReader     *read_chunk(uint32_t uid, uint32_t magic);

                /**
                 * Find LSPC chunk in file by magic
                 * @param magic chunk magic
                 * @param id pointer to return chunk number that can be used in the search of
                 *           next chunk with the same magic signature
                 * @param start_id minimum accepted identifier of chunk
                 * @return pointer to chunk reader
                 */
                ChunkReader     *find_chunk(uint32_t magic, uint32_t *id, uint32_t start_id = 1);

                /**
                 * Enumerate all chunk identifiers with the specified magic number
                 * @param magic chunk magic number
                 * @param list pointer to store the list of chunks, should be free()'d after use by caller
                 * @return number of chunks in list or negative error code
                 */
                ssize_t         enumerate_chunks(uint32_t magic, chunk_id_t **list);

                /**
                 * Enumerate all chunk identifiers of any type present in the file
                 * @param list pointer to store the list of chunks, should be free()'d after use by caller
                 * @return number of chunks in list or negative error code
                 */
                ssize_t         enumerate_chunks(chunk_info_t **list);

                /**
                 * Find LSPC chunk in file by magic
                 * @param magic chunk magic
                 * @param start_id start identifier of chunk
                 * @return pointer to chunk reader
                 */
                inline ChunkReader *find_chunk(uint32_t magic, uint32_t start_id = 1) { return find_chunk(magic, NULL, start_id); }
        };

    } /* namespace lspc */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_LSPC_FILE_H_ */
