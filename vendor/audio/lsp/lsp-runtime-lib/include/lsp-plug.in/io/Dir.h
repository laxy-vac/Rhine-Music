/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 18 мар. 2019 г.
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

#ifndef LSP_PLUG_IN_IO_DIR_H_
#define LSP_PLUG_IN_IO_DIR_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/io/File.h>

#ifndef PLATFORM_WINDOWS
    #include <dirent.h>
#endif /* PLATFORM_WINDOWS */

namespace lsp
{
    namespace io
    {
    #ifdef PLATFORM_WINDOWS
        struct dirhandle_t;
    #else
        typedef DIR         dirhandle_t;
    #endif /* PLATFORM_WINDOWS */

        class Dir
        {
            protected:
                status_t        nErrorCode;
                Path            sPath;
                dirhandle_t    *hDir;

            protected:
                inline status_t set_error(status_t error) { return nErrorCode = error; }

            public:
                explicit Dir();
                Dir(const Dir &) = delete;
                Dir(Dir &&) = delete;
                virtual ~Dir();

                Dir & operator = (const Dir &) = delete;
                Dir & operator = (Dir &&) = delete;

            public:
                /**
                 * Open directory
                 * @param path path to directory in UTF-8 encoding
                 * @return status of operation
                 */
                status_t    open(const char *path);

                /**
                 * Open directory
                 * @param path path to directory
                 * @return status of operation
                 */
                status_t    open(const LSPString *path);

                /**
                 * Open directory
                 * @param path path to directory
                 * @return status of operation
                 */
                status_t    open(const Path *path);

                /**
                 * Seek directory to it's beginning
                 * @return status of operation
                 */
                status_t    rewind();

                /**
                 * Read the record from directory
                 * @param path pointer to string to store new record
                 * @param full retrieve full path instead of relative
                 * @return status of operation
                 */
                status_t    read(LSPString *path, bool full = false);

                /**
                 * Read the record from directory
                 * @param path pointer to string to store new record
                 * @param full retrieve full path instead of relative
                 * @return status of operation
                 */
                status_t    read(Path *path, bool full = false);

                /**
                 * Read and stat the record from directory
                 * @param path pointer to string to store new record
                 * @param full retrieve full path instead of relative
                 * @return status of operation
                 */
                status_t    reads(LSPString *path, fattr_t *attr, bool full = false);

                /**
                 * Read and stat the record from directory
                 * @param path pointer to string to store new record
                 * @param full retrieve full path instead of relative
                 * @return status of operation
                 */
                status_t    reads(Path *path, fattr_t *attr, bool full = false);

                /**
                 * Close current directory
                 * @return status of operation
                 */
                status_t    close();

                /**
                 * Return last error code
                 * @return last error code
                 */
                inline status_t last_error() const  { return nErrorCode; };

                /**
                 * Return true if last read operations reached end of file
                 * @return true if last read operations reached end of file
                 */
                inline bool eof() const { return nErrorCode == STATUS_EOF; };

                /**
                 * Get path associated with directory
                 * @param dst pointer to path to store value
                 * @return status of operation
                 */
                inline status_t get_path(Path *dst) const { return (dst != NULL) ? dst->set(&sPath) : STATUS_BAD_ARGUMENTS; }

                /**
                 * Get path associated with directory
                 * @param dst pointer to path to store value
                 * @return status of operation
                 */
                inline status_t get_path(LSPString *dst) const { return (dst != NULL) ? dst->set(sPath.as_string()) : STATUS_BAD_ARGUMENTS; }

                /**
                 * Get path associated with directory
                 * @return pointer to UTF-8 string or NULL
                 */
                inline const char *get_path() const { return sPath.as_string()->get_utf8(); }

                /**
                 * Obtain file information, do not follow symlinks
                 * @param path UTF-8 encoded path to file
                 * @param attr structure to return file attributes
                 * @return status of operation
                 */
                status_t stat(const char *path, fattr_t *attr);

                /**
                 * Obtain file information, do not follow symlinks
                 * @param path path to file
                 * @param attr structure to return file attributes
                 * @return status of operation
                 */
                status_t stat(const LSPString *path, fattr_t *attr);

                /**
                 * Obtain file information, do not follow symlinks
                 * @param path path to file
                 * @param attr structure to return file attributes
                 * @return status of operation
                 */
                status_t stat(const Path *path, fattr_t *attr);

                /**
                 * Obtain file information, follow symlinks
                 * @param path UTF-8 encoded path to file
                 * @param attr structure to return file attributes
                 * @return status of operation
                 */
                status_t sym_stat(const char *path, fattr_t *attr);

                /**
                 * Obtain file information, follow symlinks
                 * @param path path to file
                 * @param attr structure to return file attributes
                 * @return status of operation
                 */
                status_t sym_stat(const LSPString *path, fattr_t *attr);

                /**
                 * Obtain file information, follow symlinks
                 * @param path path to file
                 * @param attr structure to return file attributes
                 * @return status of operation
                 */
                status_t sym_stat(const Path *path, fattr_t *attr);

                /**
                 * Create directory
                 * @param path path to the directory
                 * @return status of operation
                 */
                static status_t create(const char *path);

                /**
                 * Create directory
                 * @param path path to the directory
                 * @return status of operation
                 */
                static status_t create(const LSPString *path);

                /**
                 * Create directory
                 * @param path path to the directory
                 * @return status of operation
                 */
                static status_t create(const Path *path);

                /**
                 * Delete directory
                 * @param path path to directory
                 * @return status of operation
                 */
                static status_t remove(const char *path);

                /**
                 * Delete directory
                 * @param path path to directory
                 * @return status of operation
                 */
                static status_t remove(const LSPString *path);

                /**
                 * Delete directory
                 * @param path path to directory
                 * @return status of operation
                 */
                static status_t remove(const Path *path);

                /**
                 * Delete directory
                 * @param path path to directory
                 * @return status of operation
                 */
                static status_t get_current(LSPString *path);

                /**
                 * Delete directory
                 * @param path path to directory
                 * @return status of operation
                 */
                static status_t get_current(Path *path);
        };
    
    } /* namespace io */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_DIR_H_ */
