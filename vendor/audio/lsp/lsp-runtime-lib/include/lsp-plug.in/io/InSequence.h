/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 16 июн. 2018 г.
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

#ifndef LSP_PLUG_IN_IO_INSEQUENCE_H_
#define LSP_PLUG_IN_IO_INSEQUENCE_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/io/charset.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/io/File.h>
#include <lsp-plug.in/io/CharsetDecoder.h>
#include <lsp-plug.in/io/IInSequence.h>
#include <lsp-plug.in/io/IInStream.h>
#include <lsp-plug.in/stdlib/stdio.h>

namespace lsp
{
    namespace io
    {
        class InSequence: public IInSequence
        {
            protected:
                IInStream      *pIS;
                size_t          nWrapFlags;
                CharsetDecoder  sDecoder;
                LSPString       sLine;
    
            private:
                lsp_swchar_t read_internal();

            public:
                explicit InSequence();
                InSequence(const InSequence &) = delete;
                InSequence(InSequence &&) = delete;
                virtual ~InSequence();

                InSequence & operator = (const InSequence &) = delete;
                InSequence & operator = (InSequence &&) = delete;

            public:
                /** Wrap stdio file descriptor. The Sequence should be in closed state.
                 *
                 * @param fd file descriptor
                 * @param close close file descriptor on close()
                 * @param charset character set to use, system charset if NULL
                 * @return status of operation
                 */
                status_t wrap(FILE *fd, bool close, const char *charset = NULL);

                /** Wrap native file descriptor. The Sequence should be in closed state.
                 *
                 * @param fd file descriptor
                 * @param close close file descriptor on close()
                 * @param charset character set to use, system charset if NULL
                 * @return status of operation
                 */
                status_t wrap_native(fhandle_t fd, bool close, const char *charset = NULL);

                /** Wrap file descriptor. The Sequence should be in closed state.
                 *
                 * @param fd file descriptor
                 * @param flags wrapping flags
                 * @param charset character set to use, system charset if NULL
                 * @return status of operation
                 */
                status_t wrap(File *fd, size_t flags, const char *charset = NULL);

                /** Wrap input stream. The Sequence should be in closed state.
                 *
                 * @param is input stream to wrap
                 * @param flags wrapping flags
                 * @param charset character set to use, system charset if NULL
                 * @return status of operation
                 */
                status_t wrap(IInStream *is, size_t flags, const char *charset = NULL);

                /** Open input stream associated with file. The Sequence should be in closed state.
                 *
                 * @param path file location path
                 * @param charset character set to use, system charset if NULL
                 * @return status of operation
                 */
                status_t open(const char *path, const char *charset = NULL);

                /** Open input stream associated with file. The Sequence should be in closed state.
                 *
                 * @param path file location path
                 * @param charset character set to use, system charset if NULL
                 * @return status of operation
                 */
                status_t open(const LSPString *path, const char *charset = NULL);

                /** Open input stream associated with file. Before open currently open stream is closed and it's
                 * state is reset.
                 *
                 * @param path file location path
                 * @param charset character set to use, system charset if NULL
                 * @return status of operation
                 */
                status_t open(const Path *path, const char *charset = NULL);

                virtual ssize_t     read(lsp_wchar_t *dst, size_t count);

                virtual lsp_swchar_t read();

                virtual status_t    read_line(LSPString *s, bool force = false);

                virtual ssize_t     skip(size_t count);

                virtual status_t    close();
        };
    }
} /* namespace lsp */

#endif /* LSP_PLUG_IN_IO_INSEQUENCE_H_ */
