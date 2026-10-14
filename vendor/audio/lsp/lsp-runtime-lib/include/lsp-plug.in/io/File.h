/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
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

#ifndef LSP_PLUG_IN_IO_FILE_H_
#define LSP_PLUG_IN_IO_FILE_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/stdlib/stdio.h>

#define IO_FILE_DEFAULT_BUF_SIZE        0x1000

namespace lsp
{
    namespace io
    {
        /**
         * Binary file interface, allows to perform read/write access
         * to the file on local file system
         */
        class File
        {
            public:
                enum seek_t {
                    FSK_SET,
                    FSK_CUR,
                    FSK_END
                };

                enum mode_t {
                    FM_READ         = 1 << 0,       // Open for reading
                    FM_WRITE        = 1 << 1,       // Open for writing
                    FM_CREATE       = 1 << 2,       // Create file if not exists
                    FM_TRUNC        = 1 << 3,       // Truncate file
                    FM_DIRECT       = 1 << 4,       // Do not use buffered input/output if possible
                    FM_EXCL         = 1 << 5,       // Do not create file if it already exists, return STATUS_ALREADY_EXISTS as error
                    FM_LOCK         = 1 << 6,       // Obtain an exclusive lock on a file
                    FM_NOWAIT       = 1 << 7,       // Do not wait for acquiring the exclusive lock

                    FM_READWRITE = FM_READ | FM_WRITE,
                    FM_WRITE_NEW = FM_CREATE | FM_WRITE | FM_TRUNC,
                    FM_READWRITE_NEW = FM_CREATE | FM_READ | FM_WRITE | FM_TRUNC
                };

            protected:
                status_t    nErrorCode;

            protected:
                inline status_t set_error(status_t error) { return nErrorCode = error; }

            public:
                explicit File();
                File(const File &) = delete;
                File(File &&) = delete;
                virtual ~File();
                
                File & operator = (const File &) = delete;
                File & operator = (File &&) = delete;

            public:
                /**
                 * Read binary file
                 * @param dst target buffer to perform read
                 * @param count amount of bytes to read
                 * @return number of bytes read or negative status of operation,
                 *   on end of file -STATUS_EOF is returned
                 */
                virtual ssize_t read(void *dst, size_t count);

                /**
                 * Perform positioned read of binary file
                 * @param pos offset in bytes relative to the beginning of the file
                 * @param dst target buffer to perform read
                 * @param count amount of bytes to read
                 * @return number of bytes read or status of operation
                 */
                virtual ssize_t pread(wsize_t pos, void *dst, size_t count);

                /**
                 * Write binary file.
                 * The implementation should write the most possible amount
                 * of bytes before exit. Such behaviour will simplify the caller's
                 * implementation.
                 * @param src source buffer to perform write
                 * @param count number of bytes to write
                 * @return status of operation
                 */
                virtual ssize_t write(const void *src, size_t count);

                /**
                 * Perform positioned write of binary file
                 * @param pos offset in bytes relative to the beginning of the file
                 * @param src source buffer to perform write
                 * @param count number of bytes to write
                 * @return status of operation
                 */
                virtual ssize_t pwrite(wsize_t pos, const void *src, size_t count);

                /**
                 * Perform seek to the specified position
                 * @param pos position to perform seek
                 * @param type seek type
                 * @return status of operation
                 */
                virtual status_t seek(wssize_t pos, size_t type);

                /**
                 * Obtain current file's position
                 * @return current file's position or negative error code
                 */
                virtual wssize_t position();

                /**
                 * Obtain current file's size
                 * @return current file's size or negative error code
                 */
                virtual wssize_t size();

                /**
                 * Get file attributes
                 * @param attr file attributes
                 * @return status of operation
                 */
                virtual status_t stat(fattr_t *attr);

                /**
                 * Truncate the file
                 * @param length the final file length
                 * @return status of operation
                 */
                virtual status_t truncate(wsize_t length);

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
                 * Flush usespace file buffer
                 * @return status of operation
                 */
                virtual status_t flush();

                /**
                 * Sync file with the underlying storage
                 * @return status of operation
                 */
                virtual status_t sync();

                /**
                 * Close file
                 * @return status of operation
                 */
                virtual status_t close();

            public:

                /**
                 * Obtain file information. If the file is symbolic link,
                 * return information about the symbolic link
                 * @param path UTF-8 encoded path to file
                 * @param attr structure to return file attributes
                 * @return status of operation
                 */
                static status_t stat(const char *path, fattr_t *attr);

                /**
                 * Obtain file information. If the file is symbolic link,
                 * return information about the symbolic link
                 * @param path path to file
                 * @param attr structure to return file attributes
                 * @return status of operation
                 */
                static status_t stat(const LSPString *path, fattr_t *attr);

                /**
                 * Obtain file information. If the file is symbolic link,
                 * return information about the symbolic link
                 * @param path path to file
                 * @param attr structure to return file attributes
                 * @return status of operation
                 */
                static status_t stat(const Path *path, fattr_t *attr);

                /**
                 * Obtain file information
                 * @param fd native file descriptor
                 * @param attr structure to return file attributes
                 * @return status of operation
                 */
                static status_t stat(fhandle_t fd, fattr_t *attr);

                /**
                 * Obtain file information
                 * @param fd stdio file descriptor
                 * @param attr structure to return file attributes
                 * @return status of operation
                 */
                static status_t stat(FILE *fd, fattr_t *attr);

                /**
                 * Obtain file information. If the file is symbolic link,
                 * return information about the file the link refers to
                 * @param path UTF-8 encoded path to file
                 * @param attr structure to return file attributes
                 * @return status of operation
                 */
                static status_t sym_stat(const char *path, fattr_t *attr);

                /**
                 * Obtain file information. If the file is symbolic link,
                 * return information about the file the link refers to
                 * @param path path to file
                 * @param attr structure to return file attributes
                 * @return status of operation
                 */
                static status_t sym_stat(const LSPString *path, fattr_t *attr);

                /**
                 * Obtain file information. If the file is symbolic link,
                 * return information about the file the link refers to
                 * @param path path to file
                 * @param attr structure to return file attributes
                 * @return status of operation
                 */
                static status_t sym_stat(const Path *path, fattr_t *attr);

                /**
                 * Delete file
                 * @param path path to file
                 * @return status of operation
                 */
                static status_t remove(const char *path);

                /**
                 * Delete file
                 * @param path path to file
                 * @return status of operation
                 */
                static status_t remove(const LSPString *path);

                /**
                 * Delete file
                 * @param path path to file
                 * @return status of operation
                 */
                static status_t remove(const Path *path);

                /**
                 * Rename the file. If the destination file exists, it will be replaced
                 *
                 * @param from source name
                 * @param to destination name
                 * @return status of operation
                 */
                static status_t rename(const char *from, const char *to);
                static status_t rename(const LSPString *from, const char *to);
                static status_t rename(const Path *from, const char *to);

                static status_t rename(const char *from, const LSPString *to);
                static status_t rename(const LSPString *from, const LSPString *to);
                static status_t rename(const Path *from, const LSPString *to);

                static status_t rename(const char *from, const Path *to);
                static status_t rename(const LSPString *from, const Path *to);
                static status_t rename(const Path *from, const Path *to);

                /**
                 * Copy the file.
                 * @param from source file path
                 * @param to destination file path
                 * @param io_buf_size the size of the IO buffer
                 * @return number of bytes copied or negative error code
                 */
                static wssize_t copy(const char *from, const char *to, size_t io_buf_size = IO_FILE_DEFAULT_BUF_SIZE);
                static wssize_t copy(const LSPString *from, const char *to, size_t io_buf_size = IO_FILE_DEFAULT_BUF_SIZE);
                static wssize_t copy(const Path *from, const char *to, size_t io_buf_size = IO_FILE_DEFAULT_BUF_SIZE);

                static wssize_t copy(const char *from, const LSPString *to, size_t io_buf_size = IO_FILE_DEFAULT_BUF_SIZE);
                static wssize_t copy(const LSPString *from, const LSPString *to, size_t io_buf_size = IO_FILE_DEFAULT_BUF_SIZE);
                static wssize_t copy(const Path *from, const LSPString *to, size_t io_buf_size = IO_FILE_DEFAULT_BUF_SIZE);

                static wssize_t copy(const char *from, const Path *to, size_t io_buf_size = IO_FILE_DEFAULT_BUF_SIZE);
                static wssize_t copy(const LSPString *from, const Path *to, size_t io_buf_size = IO_FILE_DEFAULT_BUF_SIZE);
                static wssize_t copy(const Path *from, const Path *to, size_t io_buf_size = IO_FILE_DEFAULT_BUF_SIZE);

                /**
                 * Create parent directory
                 * @param path path to the directory
                 * @return status of operation
                 */
                static status_t mkparent(const char *path);
                static status_t mkparent(const LSPString *path);
                static status_t mkparent(const io::Path *path);

                static status_t mkparent(const char *path, bool recursive);
                static status_t mkparent(const LSPString *path, bool recursive);
                static status_t mkparent(const io::Path *path, bool recursive);
        };
    
    } /* namespace io */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_FILE_H_ */
