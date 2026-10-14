/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 6 мар. 2019 г.
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

#ifndef LSP_PLUG_IN_IO_STDIOFILE_H_
#define LSP_PLUG_IN_IO_STDIOFILE_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/io/File.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/stdlib/stdio.h>

namespace lsp
{
    namespace io
    {
        /**
         * This class provides file interface that uses <stdio.h> file functions
         * at the backend for file operations. Also this class allows to
         * wrap standard FILE * pointer into an object instance.
         */
        class StdioFile: public File
        {
            private:
                enum flags_t
                {
                    SF_READ     = 1 << 0,
                    SF_WRITE    = 1 << 1,
                    SF_CLOSE    = 1 << 2
                };

            protected:
                FILE       *pFD;
                size_t      nFlags;

            public:
                explicit StdioFile();
                StdioFile(const StdioFile &) = delete;
                StdioFile(StdioFile &&) = delete;
                virtual ~StdioFile() override;

                StdioFile &operator = (const StdioFile &) = delete;
                StdioFile &operator = (StdioFile &&) = delete;

            public:
                /**
                 * Open file
                 * @param path file location
                 * @param mode open mode
                 * @return status of operation
                 */
                status_t    open(const char *path, size_t mode);

                /**
                 * Open file
                 * @param path file location
                 * @param mode open mode
                 * @return status of operation
                 */
                status_t    open(const LSPString *path, size_t mode);

                /**
                 * Open file
                 * @param path file location
                 * @param mode open mode
                 * @return status of operation
                 */
                status_t    open(const Path *path, size_t mode);

                /**
                 * Wrap the standard file descriptor and allow both read
                 * and write operations
                 * @param fd file descriptor to wrap
                 * @param close close the file descriptor on close() call
                 * @return status of operation
                 */
                status_t    wrap(FILE *fd, bool close);

                /**
                 * Wrap the standard file descriptor
                 * @param fd file descriptor to wrap
                 * @param mode allowed access modes (read, write or both)
                 * @param close close the file descriptor on close() call
                 * @return status of operation
                 */
                status_t    wrap(FILE *fd, size_t mode, bool close);

                /**
                 * Read binary file
                 * @param dst target buffer to perform read
                 * @param count amount of bytes to read
                 * @return number of bytes read or negative status of operation,
                 *   on end of file -STATUS_EOF is returned
                 */
                virtual ssize_t read(void *dst, size_t count) override;

                /**
                 * Perform positioned read of binary file
                 * @param pos offset in bytes relative to the beginning of the file
                 * @param dst target buffer to perform read
                 * @param count amount of bytes to read
                 * @return number of bytes read or status of operation
                 */
                virtual ssize_t pread(wsize_t pos, void *dst, size_t count) override;

                /**
                 * Write binary file
                 * @param src source buffer to perform write
                 * @param count number of bytes to write
                 * @return number of bytes written or negative status of operation
                 */
                virtual ssize_t write(const void *src, size_t count) override;

                /**
                 * Perform positioned write of binary file
                 * @param pos offset in bytes relative to the beginning of the file
                 * @param src source buffer to perform write
                 * @param count number of bytes to write
                 * @return status of operation
                 */
                virtual ssize_t pwrite(wsize_t pos, const void *src, size_t count) override;

                /**
                 * Perform seek to the specified position
                 * @param pos position to perform seek
                 * @param type seek type
                 * @return status of operation
                 */
                virtual status_t seek(wssize_t pos, size_t type) override;

                /**
                 * Obtain current file's position
                 * @return current file's position or negative error code
                 */
                virtual wssize_t position() override;

                /**
                 * Obtain current file's size
                 * @return current file's size or negative error code
                 */
                virtual wssize_t size() override;

                /**
                 * Get file attributes
                 * @param attr file attributes
                 * @return status of operation
                 */
                virtual status_t stat(fattr_t *attr) override;

                /**
                 * Truncate the file
                 * @param length the final file length
                 * @return status of operation
                 */
                virtual status_t truncate(wsize_t length) override;

                /**
                 * Flush file buffer to underlying storage
                 * @return status of operation
                 */
                virtual status_t flush() override;

                /**
                 * Sync file with the underlying storage
                 * @return status of operation
                 */
                virtual status_t sync() override;

                /**
                 * Close file
                 * @return status of operation
                 */
                virtual status_t close() override;
        };
    
    } /* namespace io */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_STDIOFILE_H_ */
