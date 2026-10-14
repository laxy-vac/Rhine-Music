/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 29 авг. 2019 г.
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

#ifndef LSP_PLUG_IN_FMT_JAVA_OBJECT_H_
#define LSP_PLUG_IN_FMT_JAVA_OBJECT_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/fmt/java/const.h>

namespace lsp
{
    namespace java
    {
        typedef uint32_t            handle_t;

        class ObjectStreamClass;
        class RawArray;
        class Enum;
        class String;

        typedef struct object_slot_t
        {
            ObjectStreamClass      *desc;   // Slot descriptor
            size_t                  offset; // Offset from data beginning
            size_t                  size;   // Size in bytes
            size_t                  __pad;
        } object_slot_t;

        /**
         * This is common Java object implementation,
         * should be always allocated with new() operator
         */
        class Object
        {
            public:
                static const char *CLASS_NAME;

            private:
                friend class ObjectStream;
                friend class RawArray;

            protected:
                const char     *pClass;
                object_slot_t  *vSlots;
                size_t          nSlots;
                uint8_t        *vData;

            private:
                template <class type_t, class cast_t>
                    inline status_t    read_reference(const char *field, type_t *item, ftype_t type) const;

                template <class type_t, class wrapper_t>
                    inline status_t    read_prim_item(const char *field, type_t *item, ftype_t type) const;

            protected:
                virtual status_t to_string_padded(LSPString *dst, size_t pad);
                static bool pad_string(LSPString *dst, size_t pad);

            public:
                explicit Object(const char *class_name);
                Object(const Object &) = delete;
                Object(Object &&) = delete;
                virtual ~Object();

                Object & operator = (const Object &) = delete;
                Object & operator = (Object &&) = delete;

            public:
                inline const char *class_name() const { return pClass; }

                virtual bool instanceof(const char *name) const;

            public:
                status_t    get_byte(const char *field, byte_t *dst) const;
                status_t    get_short(const char *field, short_t *dst) const;
                status_t    get_int(const char *field, int_t *dst) const;
                status_t    get_long(const char *field, long_t *dst) const;
                status_t    get_float(const char *field, float_t *dst) const;
                status_t    get_double(const char *field, double_t *dst) const;
                status_t    get_char(const char *field, char_t *dst) const;
                status_t    get_bool(const char *field, bool_t *dst) const;
                status_t    get_array(const char *field, const RawArray **dst) const;
                status_t    get_object(const char *field, const Object **dst) const;
                status_t    get_string(const char *field, const String **dst) const;
                status_t    get_string(const char *field, LSPString *dst) const;
                status_t    get_string(const char *field, const char **dst) const;
                status_t    get_enum(const char *field, const Enum **dst) const;
                status_t    get_enum(const char *field, LSPString *dst) const;
                status_t    get_enum(const char *field, const char **dst) const;

            public:
                template <class T>
                    inline T *cast() { return (instanceof(T::CLASS_NAME)) ? static_cast<T *>(this) : NULL; }

                template <class T>
                    inline const T *cast() const { return (instanceof(T::CLASS_NAME)) ? static_cast<const T *>(this) : NULL; }

                status_t to_string(LSPString *dst) const;
        };

    } /* namespace java */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_JAVA_OBJECT_H_ */
