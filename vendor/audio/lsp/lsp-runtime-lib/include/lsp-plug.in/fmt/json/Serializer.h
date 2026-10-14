/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 17 окт. 2019 г.
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

#ifndef LSP_PLUG_IN_FMT_JSON_SERIALIZER_H_
#define LSP_PLUG_IN_FMT_JSON_SERIALIZER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/io/IOutStream.h>
#include <lsp-plug.in/io/IOutSequence.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/fmt/json/token.h>
#include <lsp-plug.in/lltl/darray.h>

namespace lsp
{
    namespace json
    {
        
        class Serializer
        {
            protected:
                enum pmode_t
                {
                    WRITE_ROOT,
                    WRITE_ARRAY,
                    WRITE_OBJECT
                };

                enum serialize_flags_t
                {
                    SF_PROPERTY     = 1 << 0,
                    SF_VALUE        = 1 << 1,
                    SF_COMMA        = 1 << 2,
                    SF_CONTENT      = 1 << 3
                };

                typedef struct state_t
                {
                    pmode_t                     mode;
                    size_t                      flags;
                    size_t                      ident;
                } state_t;

            protected:
                io::IOutSequence           *pOut;
                size_t                      nWFlags;
                state_t                     sState;
                lltl::darray<state_t>       sStack;
                serial_flags_t              sSettings;

            protected:
                inline status_t     push_state(pmode_t state);
                status_t            pop_state();
                inline void         copy_settings(const serial_flags_t *flags);

                inline char         hex(int x);
                status_t            write_raw(const char *buf, int len);
                status_t            write_literal(const LSPString *value);
                inline status_t     emit_comma();
                inline status_t     emit_separator();

            public:
                explicit Serializer();
                Serializer(const Serializer &) = delete;
                Serializer(Serializer &&) = delete;
                virtual ~Serializer();

                Serializer & operator = (const Serializer &) = delete;
                Serializer & operator = (Serializer &&) = delete;

            public:
                /**
                 * Open serializer
                 * @param path UTF-8 path to the file
                 * @param settings serialization flags
                 * @param charset character set
                 * @return status of operation
                 */
                status_t    open(const char *path, const serial_flags_t *settings, const char *charset = NULL);

                /**
                 * Open serializer
                 * @param path string representation of path to the file
                 * @param settings serialization flags
                 * @param charset character set
                 * @return status of operation
                 */
                status_t    open(const LSPString *path, const serial_flags_t *settings, const char *charset = NULL);

                /**
                 * Open serializer
                 * @param path path to the file
                 * @param settings serialization flags
                 * @param charset character set
                 * @return status of operation
                 */
                status_t    open(const io::Path *path, const serial_flags_t *settings, const char *charset = NULL);

                /**
                 * Wrap string with serializer
                 * @param str string to wrap
                 * @param settings serialization flags
                 * @return status of operation
                 */
                status_t    wrap(LSPString *str, const serial_flags_t *settings);

                /**
                 * Wrap input sequence with serializer
                 * @param seq sequence to use for reads
                 * @param settings serialization flags
                 * @param flags wrapping flags
                 * @return status of operation
                 */
                status_t    wrap(io::IOutSequence *seq, const serial_flags_t *settings, size_t flags = WRAP_NONE);

                /**
                 * Wrap input stream with serializer
                 * @param os output stream
                 * @param settings serialization flags
                 * @param flags wrapping flags
                 * @param charset character set
                 * @return status of operation
                 */
                status_t    wrap(io::IOutStream *os, const serial_flags_t *settings, size_t flags = WRAP_NONE, const char *charset = NULL);

                /**
                 * Close serializer
                 * @return status of operation
                 */
                status_t    close();

            public:

                /**
                 * Write JSON event to output
                 * @param event event to write
                 * @return status of operation
                 */
                status_t    write(const event_t *event);

                /**
                 * Write comma
                 * @return status of operation
                 */
                status_t    write_comma();

                /**
                 * Write new line
                 * @return status of operation
                 */
                status_t    writeln();

                /**
                 * Write integer value
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    write_int(int32_t value);

                /**
                 * Write integer value
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    write_int(uint32_t value);

                /**
                 * Write integer value
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    write_int(int64_t value);

                /**
                 * Write integer value
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    write_int(uint64_t value);

                /**
                 * Write hexadecimal value
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    write_hex(int32_t value);

                /**
                 * Write hexadecimal value
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    write_hex(uint32_t value);

                /**
                 * Write hexadecimal value
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    write_hex(int64_t value);

                /**
                 * Write hexadecimal value
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    write_hex(uint64_t value);

                /**
                 * Write double
                 * @param value double value
                 * @return status of operation
                 */
                status_t    write_double(double value);

                /**
                 * Write double
                 * @param value double value
                 * @param fmt format specifier (same as for sprintf)
                 * @return status of operation
                 */
                status_t    write_double(double value, const char *fmt);

                /**
                 * Write boolean value
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    write_bool(bool value);

                /**
                 * Write string value
                 * @param value value to write, NULL will be interpreted as NULL value
                 * @param charset character set
                 * @return status of operation
                 */
                status_t    write_string(const char *value, const char *charset);

                /**
                 * Write string in UTF-8
                 * @param value value to write, NULL will be interpreted as NULL value
                 * @return status of operation
                 */
                status_t    write_string(const char *value);

                /**
                 * Write string value
                 * @param value value to write, NULL will be interpreted as NULL value
                 * @return status of operation
                 */
                status_t    write_string(const LSPString *value);

                /**
                 * Write null value
                 * @return status of operation
                 */
                status_t    write_null();

                /**
                 * Write comment
                 * @param value comment to write
                 * @return status of operation
                 */
                status_t    write_comment(const char *value, const char *charset);

                /**
                 * Write comment in UTF-8 encoding
                 * @param value comment to write
                 * @return status of operation
                 */
                status_t    write_comment(const char *value);

                /**
                 * Write comment
                 * @param value comment to write
                 * @return status of operation
                 */
                status_t    write_comment(const LSPString *value);

                /**
                 * Write property
                 * @param name property name
                 * @param charset character set
                 * @return status of operation
                 */
                status_t    write_property(const char *name, const char *charset);

                /**
                 * Write property in UTF-8 encoding
                 * @param name property name
                 * @return status of operation
                 */
                status_t    write_property(const char *name);

                /**
                 * Write property
                 * @param name property name
                 * @return status of operation
                 */
                status_t    write_property(const LSPString *name);

                /**
                 * Write hexadecimal property
                 * @param key UTF-8 property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_int(const char *key, int32_t value);


                /**
                 * Write integer property
                 * @param key property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_int(const LSPString *key, int32_t value);

                /**
                 * Write hexadecimal property
                 * @param key UTF-8 property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_int(const char *key, uint32_t value);


                /**
                 * Write integer property
                 * @param key property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_int(const LSPString *key, uint32_t value);

                /**
                 * Write integer property
                 * @param key UTF-8 property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_int(const char *key, int64_t value);

                /**
                 * Write integer property
                 * @param key property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_int(const LSPString *key, int64_t value);

                /**
                 * Write integer property
                 * @param key UTF-8 property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_int(const char *key, uint64_t value);

                /**
                 * Write integer property
                 * @param key property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_int(const LSPString *key, uint64_t value);

                /**
                 * Write hexadecimal property
                 * @param key UTF-8 property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_hex(const char *key, int32_t value);

                /**
                 * Write hexadecimal property
                 * @param key property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_hex(const LSPString *key, int32_t value);

                /**
                 * Write hexadecimal property
                 * @param key UTF-8 property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_hex(const char *key, uint32_t value);

                /**
                 * Write hexadecimal property
                 * @param key property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_hex(const LSPString *key, uint32_t value);

                /**
                 * Write hexadecimal property
                 * @param key UTF-8 property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_hex(const char *key, int64_t value);

                /**
                 * Write hexadecimal property
                 * @param key property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_hex(const LSPString *key, int64_t value);

                /**
                 * Write hexadecimal property
                 * @param key UTF-8 property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_hex(const char *key, uint64_t value);

                /**
                 * Write hexadecimal property
                 * @param key property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_hex(const LSPString *key, uint64_t value);

                /**
                 * Write double property
                 * @param key UTF-8 property name
                 * @param value double value
                 * @return status of operation
                 */
                status_t    prop_double(const char *key, double value);

                /**
                 * Write double property
                 * @param key property name
                 * @param value double value
                 * @return status of operation
                 */
                status_t    prop_double(const LSPString *key, double value);

                /**
                 * Write double property
                 * @param key UTF-8 property name
                 * @param value double value
                 * @param fmt format specifier (same as for sprintf)
                 * @return status of operation
                 */
                status_t    prop_double(const char *key, double value, const char *fmt);

                /**
                 * Write double property
                 * @param key property name
                 * @param value double value
                 * @param fmt format specifier (same as for sprintf)
                 * @return status of operation
                 */
                status_t    prop_double(const LSPString *key, double value, const char *fmt);

                /**
                 * Write boolean property
                 * @param key UTF-8 property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_bool(const char *key, bool value);

                /**
                 * Write boolean property
                 * @param key property name
                 * @param value value to write
                 * @return status of operation
                 */
                status_t    prop_bool(const LSPString *key, bool value);

                /**
                 * Write string in UTF-8
                 * @param key UTF-8 property name
                 * @param value value to write, NULL will be interpreted as NULL value
                 * @return status of operation
                 */
                status_t    prop_string(const char *key, const char *value);

                /**
                 * Write string value
                 * @param key UTF-8 property name
                 * @param value value to write, NULL will be interpreted as NULL value
                 * @return status of operation
                 */
                status_t    prop_string(const char *key, const LSPString *value);

                /**
                 * Write string in UTF-8
                 * @param key UTF-8 property name
                 * @param value value to write, NULL will be interpreted as NULL value
                 * @return status of operation
                 */
                status_t    prop_string(const LSPString *key, const char *value);

                /**
                 * Write string value
                 * @param key UTF-8 property name
                 * @param value value to write, NULL will be interpreted as NULL value
                 * @return status of operation
                 */
                status_t    prop_string(const LSPString *key, const LSPString *value);

                /**
                 * Write null property
                 * @param key UTF-8 property name
                 * @return status of operation
                 */
                status_t    prop_null(const char *key);

                /**
                 * Write null property
                 * @param key property name
                 * @return status of operation
                 */
                status_t    prop_null(const LSPString *key);

                /**
                 * Write beginning of the object
                 * @return status of operation
                 */
                status_t    start_object();

                /**
                 * Write the end of the object
                 * @return status of operation
                 */
                status_t    end_object();

                /**
                 * Write beginning of the array
                 * @return status of operation
                 */
                status_t    start_array();

                /**
                 * Write the end of the array
                 * @return status of operation
                 */
                status_t    end_array();

            public:
                /**
                 * Get multiline flag
                 * @return multiline flag
                 */
                inline bool get_multiline() const { return sSettings.multiline; }

                /**
                 * Get multiline flag
                 * @return multiline flag
                 */
                inline bool set_multiline(bool multiline)
                {
                    bool prev = sSettings.multiline;
                    sSettings.multiline = multiline;
                    return prev;
                }
        };
    
    } /* namespace json */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_JSON_SERIALIZER_H_ */
