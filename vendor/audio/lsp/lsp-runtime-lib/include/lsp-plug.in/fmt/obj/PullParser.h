/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 21 апр. 2017 г.
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

#ifndef LSP_PLUG_IN_FMT_OBJ_PULLPARSER_H_
#define LSP_PLUG_IN_FMT_OBJ_PULLPARSER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>

#include <lsp-plug.in/io/IInSequence.h>
#include <lsp-plug.in/io/IInStream.h>
#include <lsp-plug.in/io/Path.h>

#include <lsp-plug.in/fmt/obj/const.h>

namespace lsp
{
    namespace obj
    {
        class PullParser
        {
            public:
                static const size_t IO_BUF_SIZE         = 8192;

            protected:
                io::IInSequence    *pIn;
                size_t              nWFlags;

                LSPString           sLine;          // Last read line
                lsp_wchar_t        *pBuffer;        // Buffer for character data
                size_t              nBufOff;        // Buffer offset
                size_t              nBufLen;        // Buffer length
                size_t              nLines;         // Number of lines read

                event_t             sEvent;
                ssize_t             nVx;            // Number of vertexes
                ssize_t             nParVx;         // Number of parameter vertexes
                ssize_t             nTexVx;         // Number of texture vertexes
                ssize_t             nNormVx;        // Number of normal vertexes

            protected:
                status_t            read_event();
                status_t            read_line();
                status_t            copy_event(event_t *ev) const;
                status_t            eliminate_comments();
                status_t            parse_line(const char *s);

                static inline bool  is_space(char ch);
                static bool         prefix_match(const char *s, const char *prefix);
                static const char  *skip_spaces(const char *s);
                static bool         parse_float(float *dst, const char **s);
                static bool         parse_int(ssize_t *dst, const char **s);
                static bool         end_of_line(const char *s);

            public:
                explicit PullParser();
                PullParser(const PullParser &) = delete;
                PullParser(PullParser &&) = delete;
                ~PullParser();

                PullParser & operator = (const PullParser &) = delete;
                PullParser & operator = (PullParser &&) = delete;

            public:
                /**
                 * Open parser
                 * @param path UTF-8 path to the file
                 * @param charset character set
                 * @return status of operation
                 */
                status_t            open(const char *path, const char *charset = NULL);

                /**
                 * Open parser
                 * @param path string representation of path to the file
                 * @param charset character set
                 * @return status of operation
                 */
                status_t            open(const LSPString *path, const char *charset = NULL);

                /**
                 * Open parser
                 * @param path path to the file
                 * @param charset character set
                 * @return status of operation
                 */
                status_t            open(const io::Path *path, const char *charset = NULL);

                /**
                 * Wrap string with parser
                 * @param str string to wrap
                 * @param charset character set
                 * @return status of operation
                 */
                status_t            wrap(const char *str, const char *charset = NULL);

                /**
                 * Wrap string with parser
                 * @param str string to wrap
                 * @return status of operation
                 */
                status_t            wrap(const LSPString *str);

                /**
                 * Wrap input sequence with parser
                 * @param seq sequence to use for reads
                 * @return status of operation
                 */
                status_t            wrap(io::IInSequence *seq, size_t flags = WRAP_NONE);

                /**
                 * Wrap input stream with parser
                 * @param is input stream
                 * @param flags wrap flags
                 * @param charset character set
                 * @return status of operation
                 */
                status_t            wrap(io::IInStream *is, size_t flags = WRAP_NONE, const char *charset = NULL);

                /**
                 * Close parser
                 * @return status of operation
                 */
                status_t            close();

            public:
                /**
                 * Get next event
                 * @param ev pointer to structure to store the event
                 * @return status of operation
                 */
                status_t            next(event_t *ev = NULL);

                /**
                 * Get current event
                 * @return NULL if there is no current event
                 */
                const event_t      *current() const;

                /**
                 * Get current event
                 * @param ev pointer to structure to store the event
                 * @return NULL if there is no current event
                 */
                status_t           current(event_t *ev) const;

        };
    } /* namespace obj */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_OBJ_PULLPARSER_H_ */
