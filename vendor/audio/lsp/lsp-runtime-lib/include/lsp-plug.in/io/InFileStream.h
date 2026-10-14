/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 13 мар. 2019 г.
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

#ifndef LSP_PLUG_IN_IO_INFILESTREAM_H_
#define LSP_PLUG_IN_IO_INFILESTREAM_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/stdlib/stdio.h>
#include <lsp-plug.in/io/File.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/io/IInStream.h>

namespace lsp
{
    namespace io
    {
        /**
         * Input file stream. Allows to read file in byte streaming mode.
         */
        class InFileStream: public IInStream
        {
            protected:
                File           *pFD;
                size_t          nWrapFlags;

            public:
                explicit InFileStream();
                InFileStream(const InFileStream &)=delete;
                InFileStream(InFileStream &&)=delete;
                virtual ~InFileStream() override;

                InFileStream & operator = (const InFileStream &) = delete;
                InFileStream & operator = (InFileStream &&) = delete;

            public: // io::IInStream
                virtual wssize_t    avail() override;
                virtual wssize_t    position() override;
                virtual ssize_t     read(void *dst, size_t count) override;
                virtual wssize_t    seek(wsize_t position) override;
                virtual wssize_t    skip(wsize_t amount) override;
                virtual status_t    close() override;

            public:
                /** Wrap stdio file descriptor. The Reader should be in closed state.
                 *
                 * @param fd file descriptor
                 * @param close close file descriptor on close()
                 * @return status of operation
                 */
                status_t wrap(FILE *fd, bool close);

                /** Wrap native file descriptor. The Reader should be in closed state.
                 *
                 * @param fd file descriptor
                 * @param close close file descriptor on close()
                 * @return status of operation
                 */
                status_t wrap_native(fhandle_t fd, bool close);

                /** Wrap file descriptor. The Reader should be in closed state.
                 *
                 * @param fd file descriptor
                 * @param flags wrapping flags
                 * @return status of operation
                 */
                status_t wrap(File *fd, size_t flags);

                /** Open input stream associated with file. The Reader should be in closed state.
                 *
                 * @param path file location path
                 * @return status of operation
                 */
                status_t open(const char *path);

                /** Open input stream associated with file. The Reader should be in closed state.
                 *
                 * @param path file location path
                 * @return status of operation
                 */
                status_t open(const LSPString *path);

                /** Open input stream associated with file. Before open currently open stream is closed and it's
                 * state is reset.
                 *
                 * @param path file location path
                 * @return status of operation
                 */
                status_t open(const Path *path);
        };
    
    } /* namespace io */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_INFILESTREAM_H_ */
