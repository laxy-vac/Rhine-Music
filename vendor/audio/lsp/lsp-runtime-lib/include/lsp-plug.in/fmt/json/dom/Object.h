/*
 * Copyright (C) 2021 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2021 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 14 февр. 2021 г.
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

#ifndef LSP_PLUG_IN_FMT_JSON_DOM_OBJECT_H_
#define LSP_PLUG_IN_FMT_JSON_DOM_OBJECT_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/fmt/json/dom/Node.h>

namespace lsp
{
    namespace json
    {
        /**
         * JSON node of object type
         */
        class Object: public Node
        {
            public:
                inline Object(): Node() {}
                inline Object(const Node &src): Node(src) {}
                inline Object(const Node *src): Node(src) {}

            public:
                Object &operator = (const Node &src)    { copy_ref(&src); return *this; }
                Object &operator = (const Node *src)    { copy_ref(src); return *this;  }

                Object &assign(const Node &src)         { copy_ref(&src); return *this; }
                Object &assign(const Node *src)         { copy_ref(src); return *this;  }

            public:
                virtual bool        valid() const;

                virtual status_t    create();

                static Object      *allocate();

                static Object       build();

            public:
                size_t      size() const;
                size_t      capacity() const;

                Node        get(const char *field);
                Node        get(const LSPString *field);

                bool        contains(const char *field) const;
                bool        contains(const LSPString *field) const;

                status_t    remove(const char *field);
                status_t    remove(const LSPString *field);

                status_t    set(const char *field, const Node *node);
                status_t    set(const LSPString *field, const Node *node);

                status_t    set(const char *field, const Node &node);
                status_t    set(const LSPString *field, const Node &node);

                status_t    fields(lltl::parray<LSPString> *list);
        };
    }
}

#endif /* LSP_PLUG_IN_FMT_JSON_DOM_OBJECT_H_ */
