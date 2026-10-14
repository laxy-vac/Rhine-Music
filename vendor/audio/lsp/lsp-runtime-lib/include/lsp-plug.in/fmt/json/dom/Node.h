/*
 * Copyright (C) 2023 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2023 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 30 янв. 2021 г.
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

#ifndef LSP_PLUG_IN_FMT_JSON_DOM_NODE_H_
#define LSP_PLUG_IN_FMT_JSON_DOM_NODE_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/lltl/parray.h>
#include <lsp-plug.in/lltl/pphash.h>

namespace lsp
{
    namespace json
    {
        class Array;
        class Boolean;
        class Double;
        class Integer;
        class Object;
        class String;

        /**
         * Generalized JSON node
         */
        class Node
        {
            public:
                enum node_type_t
                {
                    JN_NULL,
                    JN_INT,
                    JN_DOUBLE,
                    JN_BOOL,
                    JN_STRING,
                    JN_ARRAY,
                    JN_OBJECT
                };

            protected:
                typedef struct node_t
                {
                    size_t      refs;
                    node_type_t type;
                    union
                    {
                        ssize_t                             nValue;
                        double                              fValue;
                        bool                                bValue;
                        LSPString                          *sValue;
                        lltl::parray<node_t>               *pArray;
                        lltl::pphash<LSPString, node_t>    *pObject;
                        void                               *pData;
                    };
                } node_t;

            protected:
                friend class Integer;
                friend class Double;
                friend class Boolean;
                friend class Array;
                friend class Object;

            protected:
                mutable node_t     *pNode;

            protected:
                void                copy_ref(const Node *src);
                node_t             *make_ref() const;
                static void         release_ref(node_t *node);
                static void         undef_node(node_t *node);
                static node_t      *clear_node(node_t *node);
                static node_t      *create_node(node_t *node);
                static void         move_data(node_t *dst, node_t *src);

                status_t            cast_to(node_type_t type);
                status_t            cast_to_int();
                status_t            cast_to_double();
                status_t            cast_to_bool();
                status_t            cast_to_string();
                status_t            cast_to_array();
                status_t            cast_to_object();

            protected:
                Node(node_t *node);

            public:
                inline Node()                               { pNode = NULL;                 }
                Node(const Node &src);
                Node(const Node *src);
                virtual ~Node();

            public:
                inline Node &operator = (const Node &src)   { copy_ref(&src); return *this; }
                inline Node &operator = (const Node *src)   { copy_ref(src); return *this;  }

                inline Node &assign(const Node &src)        { copy_ref(&src); return *this; }
                inline Node &assign(const Node *src)        { copy_ref(src); return *this;  }

            public:
                inline bool is_null() const         { return (pNode == NULL) || (pNode->type == JN_NULL);           }
                inline bool is_int() const          { return (pNode != NULL) && (pNode->type == JN_INT);            }
                inline bool is_double() const       { return (pNode != NULL) && (pNode->type == JN_DOUBLE);         }
                inline bool is_bool() const         { return (pNode != NULL) && (pNode->type == JN_BOOL);           }
                inline bool is_string() const       { return (pNode != NULL) && (pNode->type == JN_STRING);         }
                inline bool is_object() const       { return (pNode != NULL) && (pNode->type == JN_OBJECT);         }
                inline bool is_array() const        { return (pNode != NULL) && (pNode->type == JN_ARRAY);          }
                inline node_type_t type() const     { return (pNode != NULL) ? pNode->type : JN_NULL;               }
                const char        *stype() const;
                bool of_type(const Node *src) const;
                bool of_type(const Node &src) const;
                bool of_type(node_type_t type) const;

            public:
                Integer             as_int() const;
                Double              as_double() const;
                Boolean             as_bool() const;
                String              as_string() const;
                Array               as_array() const;
                Object              as_object() const;

            public:
                virtual bool        valid() const   { return true;                                                  }

                virtual status_t    create();

                static Node         build();

                static Node        *allocate();

                inline void         undef()         { undef_node(pNode);                                            }
                inline void         set_null()      { undef_node(pNode);                                            }
        };
    } /* namespace json */
} /* namespace lsp */

#include <lsp-plug.in/fmt/json/dom/Integer.h>
#include <lsp-plug.in/fmt/json/dom/Double.h>
#include <lsp-plug.in/fmt/json/dom/Boolean.h>
#include <lsp-plug.in/fmt/json/dom/String.h>
#include <lsp-plug.in/fmt/json/dom/Array.h>
#include <lsp-plug.in/fmt/json/dom/Object.h>

#endif /* LSP_PLUG_IN_FMT_JSON_DOM_NODE_H_ */
