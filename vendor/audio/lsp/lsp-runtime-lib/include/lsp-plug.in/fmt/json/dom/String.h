/*
 * Copyright (C) 2021 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2021 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 23 февр. 2021 г.
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

#ifndef LSP_PLUG_IN_FMT_JSON_DOM_STRING_H_
#define LSP_PLUG_IN_FMT_JSON_DOM_STRING_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/fmt/json/dom/Node.h>

namespace lsp
{
    namespace json
    {
        /**
         * JSON node of String type
         */
        class String: public Node
        {
            public:
                inline String(): Node() {}
                inline String(const Node &src): Node(src) {}
                inline String(const Node *src): Node(src) {}

            public:
                String &operator = (const Node &src)   { copy_ref(&src); return *this; }
                String &operator = (const Node *src)   { copy_ref(src); return *this;  }

                String &assign(const Node &src)        { copy_ref(&src); return *this; }
                String &assign(const Node *src)        { copy_ref(src); return *this;  }

            public:
                virtual bool        valid() const;

                virtual status_t    create();

                status_t            create(const LSPString *value);
                status_t            create(const char *value, const char *charset = NULL);

                static String      *allocate();
                static String      *allocate(const LSPString *value);
                static String      *allocate(const char *value, const char *charset = NULL);

                static String       build();
                static String       build(const LSPString *value);
                static String       build(const char *value, const char *charset = NULL);

            public:
                /**
                 * Try to cast value to String and return the casted value
                 * @return String value or NULL if cast was unsuccessful
                 */
                status_t get(LSPString *dst) const;

                /**
                 * Strict get: check that value is of String type and return it
                 * @return String value or 0 if value is not String
                 */
                status_t sget(LSPString *dst) const;

                /**
                 * Cast value to String
                 * @return success if value has been successful casted
                 */
                status_t cast();

                /**
                 * Cast to String and set value
                 * @param value value to set
                 * @return success if property has been set
                 */
                status_t set(const LSPString *value);

                /**
                 * Cast to String and set value
                 * @param value value to set
                 * @return success if property has been set
                 */
                status_t set(const char *value, const char *charset = NULL);

                /**
                 * Strict set: check that value is of String type and change it
                 * @param value value to set
                 * @return success if value has been set
                 */
                status_t sset(const LSPString *value);

                /**
                 * Strict set: check that value is of String type and change it
                 * @param value value to set
                 * @return success if value has been set
                 */
                status_t sset(const char *value, const char *charset = NULL);
        };
    }
}





#endif /* LSP_PLUG_IN_FMT_JSON_DOM_STRING_H_ */
