/*
 * Copyright (C) 2021 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2021 Vladimir Sadovnikov <sadko4u@gmail.com>
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

#ifndef LSP_PLUG_IN_FMT_JSON_DOM_ARRAY_H_
#define LSP_PLUG_IN_FMT_JSON_DOM_ARRAY_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/fmt/json/dom/Node.h>

namespace lsp
{
    namespace json
    {
        /**
         * JSON node of array type
         */
        class Array: public Node
        {
            public:
                inline Array(): Node() {}
                inline Array(const Node &src): Node(src) {}
                inline Array(const Node *src): Node(src) {}

            public:
                Array &operator = (const Node &src)     { copy_ref(&src); return *this; }
                Array &operator = (const Node *src)     { copy_ref(src); return *this;  }

                Array &assign(const Node &src)          { copy_ref(&src); return *this; }
                Array &assign(const Node *src)          { copy_ref(src); return *this;  }

            public:
                virtual bool        valid() const;

                virtual status_t    create();

                static Array       *allocate();

                static Array        build();

            public:
                size_t      size() const;
                size_t      capacity() const;

                Node        get(size_t index);

                status_t    add(const Node *node);
                status_t    add(const Node &node);
                status_t    append(const Node *node);
                status_t    append(const Node &node);
                status_t    prepend(const Node *node);
                status_t    prepend(const Node &node);
                status_t    insert(size_t index, const Node *node);
                status_t    insert(size_t index, const Node &node);
                status_t    remove(size_t index);
                status_t    remove_n(size_t index, size_t count);
        };
    }
}


#endif /* LSP_PLUG_IN_FMT_JSON_DOM_ARRAY_H_ */
