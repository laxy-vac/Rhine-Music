/*
 * Copyright (C) 2021 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2021 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 31 янв. 2021 г.
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

#ifndef LSP_PLUG_IN_FMT_JSON_DOM_INTEGER_H_
#define LSP_PLUG_IN_FMT_JSON_DOM_INTEGER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/fmt/json/dom/Node.h>

namespace lsp
{
    namespace json
    {
        /**
         * JSON node of integer type
         */
        class Integer: public Node
        {
            public:
                inline Integer(): Node() {}
                inline Integer(const Node &src): Node(src) {}
                inline Integer(const Node *src): Node(src) {}

            public:
                Integer &operator = (const Node &src)   { copy_ref(&src); return *this; }
                Integer &operator = (const Node *src)   { copy_ref(src); return *this;  }

                Integer &assign(const Node &src)        { copy_ref(&src); return *this; }
                Integer &assign(const Node *src)        { copy_ref(src); return *this;  }

            public:
                virtual bool        valid() const;

                virtual status_t    create();

                status_t            create(ssize_t value);

                static Integer     *allocate(ssize_t value = 0);

                static Integer      build(ssize_t value = 0);

            public:
                /**
                 * Try to cast value to integer and return the casted value
                 * @return integer value or 0 if cast was unsuccessful
                 */
                ssize_t get() const;

                /**
                 * Strict get: check that value is of integer type and return it
                 * @return integer value or 0 if value is not integer
                 */
                ssize_t sget() const;

                /**
                 * Cast value to integer
                 * @return success if value has been successful casted
                 */
                status_t cast();

                /**
                 * Cast to integer and set value
                 * @param value value to set
                 * @return success if property has been set
                 */
                status_t set(ssize_t value);

                /**
                 * Strict set: check that value is of integer type and change it
                 * @param value value to set
                 * @return success if value has been set
                 */
                status_t sset(ssize_t value);
        };
    }
}



#endif /* LSP_PLUG_IN_FMT_JSON_DOM_INTEGER_H_ */
