/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 29 апр. 2020 г.
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

#ifndef LSP_PLUG_IN_FMT_CONFIG_PULLPARSER_H_
#define LSP_PLUG_IN_FMT_CONFIG_PULLPARSER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/io/IInSequence.h>
#include <lsp-plug.in/io/IInStream.h>

#include <lsp-plug.in/fmt/config/types.h>

namespace lsp
{
    namespace config
    {
        
        class PullParser
        {
            protected:
                io::IInSequence        *pIn;
                size_t                  nWFlags;
                param_t                 sParam;

                LSPString               sLine;
                LSPString               sKey;
                LSPString               sValue;

            protected:
                bool                skip_spaces(size_t &off);
                status_t            read_key(size_t &off);
                status_t            read_type(size_t &off, size_t &flags);
                status_t            read_value(size_t &off, size_t &flags);
                status_t            parse_line(size_t &flags);
                status_t            do_close();

                static status_t     parse_int32(const LSPString *str, int32_t *dst);
                static status_t     parse_uint32(const LSPString *str, uint32_t *dst);
                static status_t     parse_float(const LSPString *str, float *dst, size_t *flags);
                static status_t     parse_int64(const LSPString *str, int64_t *dst);
                static status_t     parse_uint64(const LSPString *str, uint64_t *dst);
                static status_t     parse_double(const LSPString *str, double *dst, size_t *flags);
                static status_t     parse_bool(const LSPString *str, bool *dst);
                static status_t     parse_blob(const LSPString *str, blob_t *dst);

            protected:
                virtual status_t    commit_param(const LSPString *key, const LSPString *value, size_t flags);

            public:
                explicit PullParser();
                PullParser(const PullParser &) = delete;
                PullParser(PullParser &&) = delete;
                virtual ~PullParser();

                PullParser & operator = (const PullParser &) = delete;
                PullParser & operator = (PullParser &&) = delete;

            public:
                /**
                 * Open parser
                 * @param path UTF-8 path to the file
                 * @param charset character set
                 * @return status of operation
                 */
                virtual status_t            open(const char *path, const char *charset = NULL);

                /**
                 * Open parser
                 * @param path string representation of path to the file
                 * @param charset character set
                 * @return status of operation
                 */
                virtual status_t            open(const LSPString *path, const char *charset = NULL);

                /**
                 * Open parser
                 * @param path path to the file
                 * @param charset character set
                 * @return status of operation
                 */
                virtual status_t            open(const io::Path *path, const char *charset = NULL);

                /**
                 * Wrap string with parser
                 * @param str string to wrap
                 * @param charset character set
                 * @return status of operation
                 */
                virtual status_t            wrap(const char *str, const char *charset = NULL);

                /**
                 * Wrap string with parser
                 * @param str string to wrap
                 * @return status of operation
                 */
                virtual status_t            wrap(const LSPString *str);

                /**
                 * Wrap input sequence with parser
                 * @param seq sequence to use for reads
                 * @return status of operation
                 */
                virtual status_t            wrap(io::IInSequence *seq, size_t flags = WRAP_NONE);

                /**
                 * Wrap input stream with parser
                 * @param is input stream
                 * @param flags wrap flags
                 * @param charset character set
                 * @return status of operation
                 */
                virtual status_t            wrap(io::IInStream *is, size_t flags = WRAP_NONE, const char *charset = NULL);

                /**
                 * Close parser
                 * @return status of operation
                 */
                virtual status_t            close();

            public:
                /**
                 * Get next event
                 * @param ev pointer to structure to store the event
                 * @return status of operation
                 */
                virtual status_t            next(param_t *ev = NULL);

                /**
                 * Get current event
                 * @return NULL if there is no current event
                 */
                virtual const param_t      *current() const;

                /**
                 * Get current event
                 * @param ev pointer to structure to store the event
                 * @return NULL if there is no current event
                 */
                virtual status_t           current(param_t *ev) const;
        };
    
    } /* namespace config */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_CONFIG_PULLPARSER_H_ */
