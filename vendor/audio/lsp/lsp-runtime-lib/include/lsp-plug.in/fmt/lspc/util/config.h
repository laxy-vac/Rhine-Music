/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 24 окт. 2022 г.
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

#ifndef LSP_PLUG_IN_FMT_LSPC_UTIL_CONFIG_H_
#define LSP_PLUG_IN_FMT_LSPC_UTIL_CONFIG_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/fmt/lspc/File.h>
#include <lsp-plug.in/mm/types.h>
#include <lsp-plug.in/io/IInStream.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/runtime/LSPString.h>

namespace lsp
{
    namespace lspc
    {
        /**
         * Write configuration entry to the LSPC file
         * @param chunk_id pointer to store allocated chunk identifier, can be NULL
         * @param file the LSPC file to write the chunk
         * @param path the location of configuration file to write
         * @param buf_size size of buffer for I/O operations
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t write_config(chunk_id_t *chunk_id, File *file, const char *path, size_t buf_size = 0x1000);

        LSP_RUNTIME_LIB_PUBLIC
        status_t write_config(chunk_id_t *chunk_id, File *file, const io::Path *path, size_t buf_size = 0x1000);

        LSP_RUNTIME_LIB_PUBLIC
        status_t write_config(chunk_id_t *chunk_id, File *file, const LSPString *path, size_t buf_size = 0x1000);

        /**
         * Write the contents of the passed stream to the LSPC file as a configuration chunk
         * @param chunk_id pointer to store allocated chunk identifier, can be NULL
         * @param file the LSPC file to write the chunk
         * @param is input stream that provides data to write
         * @param buf_size size of buffer for I/O operations
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t write_config(chunk_id_t *chunk_id, File *file, io::IInStream *is, size_t buf_size = 0x1000);

        /**
         * Create configuration entry in the LSPC file and return chunk writer that will allow to write to the entry
         * @param chunk_id pointer to store allocated chunk identifier, can be NULL
         * @param file the LSPC file to write the chunk
         * @param writer pointer to store the created chunk writer that should be deleted after use
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t write_config(chunk_id_t *chunk_id, File *file, lspc::ChunkWriter **writer);

        /**
         * Create configuration entry in the LSPC file and return chunk writer that will allow to write to the entry
         * @param chunk_id pointer to store allocated chunk identifier, can be NULL
         * @param file the LSPC file to write the chunk
         * @param os pointer to store the created output stream that should be deleted after use
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t write_config(chunk_id_t *chunk_id, File *file, io::IOutStream **os);

        /**
         * Write configuration entry data to the LSPC file
         * @param chunk_id pointer to store allocated chunk identifier, can be NULL
         * @param file the LSPC file to write the chunk
         * @param data the text configuration data to write to the file
         * @param buf_size size of buffer for I/O operations
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t write_config_data(chunk_id_t *chunk_id, File *file, const char *data, size_t buf_size = 0x1000);

        LSP_RUNTIME_LIB_PUBLIC
        status_t write_config_data(chunk_id_t *chunk_id, File *file, const LSPString *data, size_t buf_size = 0x1000);

        /**
         * Write configuration entry data to the LSPC file
         * @param chunk_id pointer to store allocated chunk identifier, can be NULL
         * @param file the LSPC file to write the chunk
         * @param data the binary data to write to the file
         * @param bytes the size of data in bytes
         * @param buf_size size of buffer for I/O operations
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t write_config_data(chunk_id_t *chunk_id, File *file, const void *data, size_t bytes, size_t buf_size = 0x1000);

        /**
         * Read configuration chunk to the file
         * @param chunk_id chunk identifier
         * @param file the LSPC file to read the chunk
         * @param path target file name
         * @param buf_size size of buffer for I/O operations
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t read_config(chunk_id_t chunk_id, File *file, const char *path, size_t buf_size = 0x1000);

        LSP_RUNTIME_LIB_PUBLIC
        status_t read_config(chunk_id_t chunk_id, File *file, const io::Path *path, size_t buf_size = 0x1000);

        LSP_RUNTIME_LIB_PUBLIC
        status_t read_config(chunk_id_t chunk_id, File *file, const LSPString *path, size_t buf_size = 0x1000);

        /**
         * Read configuration chunk to the output stream
         * @param chunk_id chunk identifier
         * @param file the LSPC file to read the chunk
         * @param os target output stream to read data
         * @param buf_size size of buffer for I/O operations
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t read_config(chunk_id_t chunk_id, File *file, io::IOutStream *os, size_t buf_size = 0x1000);

        /**
         * Read configuration chunk and return pointer to the input stream
         * @param chunk_id chunk identifier
         * @param file the LSPC file to read the chunk
         * @param is pointer to store the resulting stream, should be deleted after use
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t read_config(chunk_id_t chunk_id, File *file, io::IInStream **is);

        /**
         * Read configuration chunk into the memory and return pointer to the allocated string
         * @param chunk_id chunk identifier
         * @param file the LSPC file to read the chunk
         * @param data pointer to store the resulting string, should be free()'d by the caller after use
         * @param buf_size size of buffer for I/O operations
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t read_config_data(chunk_id_t chunk_id, File *file, char **data, size_t buf_size = 0x1000);

        /**
         * Read configuration chunk into the string
         * @param chunk_id chunk identifier
         * @param file the LSPC file to read the chunk
         * @param data string to store the result
         * @param buf_size size of buffer for I/O operations
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t read_config_data(chunk_id_t chunk_id, File *file, LSPString *data, size_t buf_size = 0x1000);

        /**
         * Read configuration chunk into the memory and return it's size
         * @param chunk_id chunk identifier
         * @param file the LSPC file to read the chunk
         * @param data pointer to store the address of the buffer, should be free()'d by the caller after use
         * @param size pointer to return the size of read data
         * @param buf_size size of buffer for I/O operations
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t read_config_data(chunk_id_t chunk_id, File *file, void **data, size_t *size, size_t buf_size = 0x1000);

    } /* namespace lspc */
} /* namespace lsp */


#endif /* LSP_PLUG_IN_FMT_LSPC_UTIL_CONFIG_H_ */
