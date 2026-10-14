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

#ifndef LSP_PLUG_IN_FMT_JSON_DOM_DOUBLE_H_
#define LSP_PLUG_IN_FMT_JSON_DOM_DOUBLE_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/fmt/json/dom/Node.h>

namespace lsp
{
    namespace json
    {
        /**
         * JSON node of floating-point type
         */
        class Double: public Node
        {
            public:
                inline Double(): Node() {}
                inline Double(const Node &src): Node(src) {}
                inline Double(const Node *src): Node(src) {}

            public:
                Double &operator = (const Node &src)    { copy_ref(&src); return *this; }
                Double &operator = (const Node *src)    { copy_ref(src); return *this;  }

                Double &assign(const Node &src)         { copy_ref(&src); return *this; }
                Double &assign(const Node *src)         { copy_ref(src); return *this;  }

            public:
                virtual bool        valid() const;

                virtual status_t    create();

                status_t            create(double value);

                static Double      *allocate(double value = 0.0);

                static Double       build(double value = 0.0);

            public:
                /**
                 * Try to cast value to Double and return the casted value
                 * @return Double value or 0 if cast was unsuccessful
                 */
                double get() const;

                /**
                 * Strict get: check that value is of Double type and return it
                 * @return Double value or 0 if value is not Double
                 */
                double sget() const;

                /**
                 * Cast value to Double
                 * @return success if value has been successful casted
                 */
                status_t cast();

                /**
                 * Cast to Double and set value
                 * @param value value to set
                 * @return success if property has been set
                 */
                status_t set(double value);

                /**
                 * Strict set: check that value is of Double type and change it
                 * @param value value to set
                 * @return success if value has been set
                 */
                status_t sset(double value);
        };

    } /* namespace json */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_FMT_JSON_DOM_DOUBLE_H_ */
