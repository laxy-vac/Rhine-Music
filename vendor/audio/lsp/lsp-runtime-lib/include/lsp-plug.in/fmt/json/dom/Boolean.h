/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 13 февр. 2021 г.
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

#ifndef LSP_PLUG_IN_FMT_JSON_DOM_BOOLEAN_H_
#define LSP_PLUG_IN_FMT_JSON_DOM_BOOLEAN_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/fmt/json/dom/Node.h>

namespace lsp
{
    namespace json
    {
        /**
         * JSON node of boolean type
         */
        class Boolean: public Node
        {
            public:
                inline Boolean(): Node() {}
                inline Boolean(const Node &src): Node(src) {}
                inline Boolean(const Node *src): Node(src) {}

            public:
                Boolean &operator = (const Node &src)   { copy_ref(&src); return *this; }
                Boolean &operator = (const Node *src)   { copy_ref(src); return *this;  }

                Boolean &assign(const Node &src)        { copy_ref(&src); return *this; }
                Boolean &assign(const Node *src)        { copy_ref(src); return *this;  }

            public:
                virtual bool        valid() const;

                virtual status_t    create();

                status_t            create(bool value);

                static Boolean     *allocate(bool value = false);

                static Boolean      build(bool value = false);

            public:
                /**
                 * Try to cast value to Boolean and return the casted value
                 * @return Boolean value or false if cast was unsuccessful
                 */
                bool get() const;

                /**
                 * Strict get: check that value is of Boolean type and return it
                 * @return Boolean value or false if value is not Boolean
                 */
                bool sget() const;

                /**
                 * Cast value to Boolean
                 * @return success if value has been successful casted
                 */
                status_t cast();

                /**
                 * Cast to Boolean and set value
                 * @param value value to set
                 * @return success if property has been set
                 */
                status_t set(bool value);

                /**
                 * Strict set: check that value is of Boolean type and change it
                 * @param value value to set
                 * @return success if value has been set
                 */
                status_t sset(bool value);
        };

    } /* namespace json */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_FMT_JSON_DOM_BOOLEAN_H_ */
