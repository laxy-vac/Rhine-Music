/*
 * Copyright (C) 2022 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2022 Vladimir Sadovnikov <sadko4u@gmail.com>
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

#ifndef LSP_PLUG_IN_FMT_LSPC_UTIL_PATH_H_
#define LSP_PLUG_IN_FMT_LSPC_UTIL_PATH_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/fmt/lspc/File.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/runtime/LSPString.h>

namespace lsp
{
    namespace lspc
    {
        /**
         * Allocate path entry and fill it's fields
         * @param path relative path of the file
         * @param flags path entry flags
         * @param reference_id refere
         * @return pointer to allocated path entry or NULL if error occurred
         */
        LSP_RUNTIME_LIB_PUBLIC
        path_entry_t *alloc_path(const char *path, size_t flags, chunk_id_t reference_id);

        LSP_RUNTIME_LIB_PUBLIC
        path_entry_t *alloc_path(const io::Path *path, size_t flags, chunk_id_t reference_id);

        LSP_RUNTIME_LIB_PUBLIC
        path_entry_t *alloc_path(const LSPString *path, size_t flags, chunk_id_t reference_id);

        /**
         * Allocate path entry with specified path length in bytes
         * @param path_len path length without trailing zero counted
         * @return allocated path entry or NULL if error occurred
         */
        LSP_RUNTIME_LIB_PUBLIC
        path_entry_t *alloc_path(size_t path_len);

        /**
         * Free previously allocated path entry
         * @param path path entry to free
         */
        LSP_RUNTIME_LIB_PUBLIC
        void free_path(path_entry_t * path);

        /**
         * Write path entry to LSPC file
         * @param chunk_id pointer to return chunk identifier, can be NULL
         * @param file the LSPC file to create chunk
         * @param path path entry
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t write_path(chunk_id_t *chunk_id, File *file, const path_entry_t *path);

        /**
         * Write path entry to LSPC file
         * @param chunk_id pointer to store allocated chunk identifier, can be NULL
         * @param file the LSPC file to write the chunk
         * @param path the path string
         * @param flags path flags
         * @param reference_id the identifier of chunk referenced by the path entry
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t write_path(chunk_id_t *chunk_id, File *file, const char *path, size_t flags, chunk_id_t reference_id);

        LSP_RUNTIME_LIB_PUBLIC
        status_t write_path(chunk_id_t *chunk_id, File *file, const io::Path *path, size_t flags, chunk_id_t reference_id);

        LSP_RUNTIME_LIB_PUBLIC
        status_t write_path(chunk_id_t *chunk_id, File *file, const LSPString *path, size_t flags, chunk_id_t reference_id);


        /**
         * Read path entry from the LSPC file
         * @param chunk_id chunk identifier
         * @param file the LSPC fiel to read the chunk
         * @param path the pointer to store the allocated path entry record, can be NULL
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t read_path(chunk_id_t chunk_id, File *file, path_entry_t **path);

        /**
         * Read path entry from the LSPC file
         * @param chunk_id chunk identifier
         * @param file the LSPC fiel to read the chunk
         * @param path the pointer to store the pointer to allocated string, can be NULL, should be free()'d after use
         * @param flags chunk flags, can be NULL
         * @param reference_id referenced chunk identifier, can be NULL
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t read_path(chunk_id_t chunk_id, File *file, char **path, size_t *flags, chunk_id_t *reference_id);

        /**
         * Read path entry from the LSPC file
         * @param chunk_id chunk identifier
         * @param file the LSPC fiel to read the chunk
         * @param path the pointer to store the path data
         * @param flags chunk flags, can be NULL
         * @param reference_id referenced chunk identifier, can be NULL
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t read_path(chunk_id_t chunk_id, File *file, io::Path *path, size_t *flags, chunk_id_t *reference_id);

        LSP_RUNTIME_LIB_PUBLIC
        status_t read_path(chunk_id_t chunk_id, File *file, LSPString *path, size_t *flags, chunk_id_t *reference_id);
    } /* namespace lspc */
} /* namespace lsp */


#endif /* LSP_PLUG_IN_FMT_LSPC_UTIL_PATH_H_ */
