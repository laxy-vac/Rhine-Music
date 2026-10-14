/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 1 мая 2020 г.
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

#ifndef LSP_PLUG_IN_FMT_CONFIG_SERIALIZER_H_
#define LSP_PLUG_IN_FMT_CONFIG_SERIALIZER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/io/IOutSequence.h>
#include <lsp-plug.in/io/IOutStream.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/fmt/config/types.h>

namespace lsp
{
    namespace config
    {
        /**
         * Configuration serializer
         */
        class Serializer
        {
            protected:
                io::IOutSequence       *pOut;
                size_t                  nWFlags;

            protected:
                status_t    write_key(const LSPString *key);

                status_t    write_escaped(const LSPString *key, size_t flags);
                status_t    write_uint(uint64_t v, size_t flags);
                status_t    write_int(int64_t v, size_t flags);
                status_t    write_float(double v, size_t flags);
                status_t    write_bool(bool v, size_t flags);
                status_t    write_string_impl(const LSPString *key, const LSPString *v, size_t flags);

                status_t    do_close();

            public:
                explicit Serializer();
                Serializer(const Serializer &) = delete;
                Serializer(Serializer &&) = delete;
                virtual ~Serializer();

                Serializer & operator = (const Serializer &) = delete;
                Serializer & operator = (Serializer &&) = delete;

            public:
                /**
                 * Open parser
                 * @param path UTF-8 path to the file
                 * @param charset character set
                 * @return status of operation
                 */
                virtual status_t    open(const char *path, const char *charset = NULL);

                /**
                 * Open parser
                 * @param path string representation of path to the file
                 * @param charset character set
                 * @return status of operation
                 */
                virtual status_t    open(const LSPString *path, const char *charset = NULL);

                /**
                 * Open parser
                 * @param path path to the file
                 * @param charset character set
                 * @return status of operation
                 */
                virtual status_t    open(const io::Path *path, const char *charset = NULL);

                /**
                 * Wrap string with parser
                 * @param str string to wrap
                 * @return status of operation
                 */
                virtual status_t    wrap(LSPString *str);

                /**
                 * Wrap input sequence with parser
                 * @param seq sequence to use for reads
                 * @param flags wrapping flags
                 * @return status of operation
                 */
                virtual status_t    wrap(io::IOutSequence *seq, size_t flags = WRAP_NONE);

                /**
                 * Wrap input stream with parser
                 * @param os output stream
                 * @param flags wrapping flags
                 * @param charset character set
                 * @return status of operation
                 */
                virtual status_t    wrap(io::IOutStream *os, size_t flags = WRAP_NONE, const char *charset = NULL);

                /**
                 * Close parser
                 * @return status of operation
                 */
                virtual status_t    close();

            public:
                /**
                 * Write comment to the output stream
                 * @param v comment
                 * @return status of operation
                 */
                virtual status_t    write_comment(const LSPString *v);

                /**
                 * Write comment to the output stream
                 * @param v UTF-8 encoded comment
                 * @return status of operation
                 */
                virtual status_t    write_comment(const char *v);

                /**
                 * Write empty line to the output file
                 * @return status of operation
                 */
                virtual status_t    writeln();

                /**
                 * Write value to the output stream
                 * @param key key
                 * @param v value
                 * @param flags value flags
                 * @return status of operation
                 */
                virtual status_t    write(const LSPString *key, const value_t *v, size_t flags);
                virtual status_t    write(const char *key, const value_t *v, size_t flags);

                /**
                 * Write 32-bit signed integer to the output stream
                 * @param key key
                 * @param value value
                 * @param flags value flags
                 * @return status of operation
                 */
                virtual status_t    write_i32(const LSPString *key, int32_t value, size_t flags);
                virtual status_t    write_i32(const char *key, int32_t value, size_t flags);

                /**
                 * Write 32-bit unsigned integer to the output stream
                 * @param key key
                 * @param value value
                 * @param flags value flags
                 * @return status of operation
                 */
                virtual status_t    write_u32(const LSPString *key, uint32_t value, size_t flags);
                virtual status_t    write_u32(const char *key, uint32_t value, size_t flags);

                /**
                 * Write 32-bit floating-point to the output stream
                 * @param key key
                 * @param value value
                 * @param flags value flags
                 * @return status of operation
                 */
                virtual status_t    write_f32(const LSPString *key, float value, size_t flags);
                virtual status_t    write_f32(const char *key, float value, size_t flags);

                /**
                 * Write 64-bit signed integer to the output stream
                 * @param key key
                 * @param value value
                 * @param flags value flags
                 * @return status of operation
                 */
                virtual status_t    write_i64(const LSPString *key, int64_t value, size_t flags);
                virtual status_t    write_i64(const char *key, int64_t value, size_t flags);

                /**
                 * Write 64-bit unsigned integer to the output stream
                 * @param key key
                 * @param value value
                 * @param flags value flags
                 * @return status of operation
                 */
                virtual status_t    write_u64(const LSPString *key, uint64_t value, size_t flags);
                virtual status_t    write_u64(const char *key, uint64_t value, size_t flags);

                /**
                 * Write 64-bit floating-point to the output stream
                 * @param key key
                 * @param value value
                 * @param flags value flags
                 * @return status of operation
                 */
                virtual status_t    write_f64(const LSPString *key, double value, size_t flags);
                virtual status_t    write_f64(const char *key, double value, size_t flags);

                /**
                 * Write boolean value to the output stream
                 * @param key key
                 * @param value value
                 * @param flags value flags
                 * @return status of operation
                 */
                virtual status_t    write_bool(const LSPString *key, bool value, size_t flags);
                virtual status_t    write_bool(const char *key, bool value, size_t flags);

                /**
                 * Write text string
                 * @param key key
                 * @param v string
                 * @param flags value flags
                 * @return status of operation
                 */
                virtual status_t    write_string(const LSPString *key, const LSPString *v, size_t flags);
                virtual status_t    write_string(const LSPString *key, const char *v, size_t flags);
                virtual status_t    write_string(const char *key, const LSPString *v, size_t flags);
                virtual status_t    write_string(const char *key, const char *v, size_t flags);

                /**
                 * Write blob data
                 * @param key key
                 * @param v blob data
                 * @param flags value flags
                 * @return status of operation
                 */
                virtual status_t    write_blob(const LSPString *key, const blob_t *v, size_t flags);
                virtual status_t    write_blob(const char *key, const blob_t *v, size_t flags);

                /**
                 * Write configuration parameter
                 * @param param configuration parameter
                 * @return status of operation
                 */
                status_t            write(const config::param_t * param);
                status_t            write(const config::param_t & param);
        };
    
    } /* namespace config */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_CONFIG_SERIALIZER_H_ */
