/*
 * Copyright (C) 2024 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2024 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-lltl-lib
 * Created on: 9 июн. 2020 г.
 *
 * lsp-lltl-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-lltl-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-lltl-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_LLTL_SPEC_H_
#define LSP_PLUG_IN_LLTL_SPEC_H_

#include <lsp-plug.in/lltl/version.h>

#include <lsp-plug.in/common/new.h>
#include <lsp-plug.in/lltl/types.h>

namespace lsp
{
    namespace lltl
    {
        //---------------------------------------------------------------------
        // Interface for pointers
        struct ptr_hash_iface: public hash_iface
        {
            inline ptr_hash_iface()
            {
                hash        = ptr_hash_func;
            }
        };

        struct ptr_compare_iface: public compare_iface
        {
            inline ptr_compare_iface()
            {
                compare     = ptr_cmp_func;
            }
        };

        //---------------------------------------------------------------------
        // Default specializations

        /**
         * Default specialization for hash interface
         */
        template <class T>
        struct hash_spec: public hash_iface
        {
            inline hash_spec()
            {
                hash        = default_hash_func;
            }
        };

        /**
         * Default specialization for compare interface
         */
        template <class T>
        struct compare_spec: public compare_iface
        {
            inline compare_spec()
            {
                compare     = default_compare_func;
            }
        };

        /**
         * Default specialization for allocator interface
         */
        template <class T>
        struct allocator_spec: public allocator_iface
        {
            static void *clone_func(const void *src, size_t size)
            {
                void *dst = ::malloc(size);
                return (dst) ? new(dst, inplace_new_tag_t()) T(*static_cast<const T *>(src)) : NULL;
            }

            static void free_func(void *ptr)
            {
                (static_cast<T *>(ptr))->~T();
                ::free(ptr);
            }

            inline allocator_spec()
            {
                clone       = clone_func;
                free        = free_func;
            }
        };

        //---------------------------------------------------------------------
        // Specialization for raw pointers
        template <class T>
        struct hash_spec<T *>: public hash_iface
        {
            inline hash_spec()
            {
                hash        = ptr_hash_func;
            }
        };

        /**
         * Default specialization for compare interface
         */
        template <class T>
        struct compare_spec<T *>: public compare_iface
        {
            inline compare_spec()
            {
                compare     = ptr_cmp_func;
            }
        };

        //---------------------------------------------------------------------
        // Specialization for C-strings: char *
        template <>
        struct hash_spec<char>: public hash_iface
        {
            inline hash_spec()
            {
                hash        = char_hash_func;
            }
        };

        template <>
        struct compare_spec<char>: public compare_iface
        {
            inline compare_spec()
            {
                compare     = char_cmp_func;
            }
        };

        template <>
        struct allocator_spec<char>: public allocator_iface
        {
            inline allocator_spec()
            {
                clone       = char_clone_func;
                free        = ::free;
            }
        };

        //---------------------------------------------------------------------
        // Specialization for C-strings: const char *
        template <>
        struct hash_spec<const char>: public hash_iface
        {
            inline hash_spec()
            {
                hash        = char_hash_func;
            }
        };

        template <>
        struct compare_spec<const char>: public compare_iface
        {
            inline compare_spec()
            {
                compare     = char_cmp_func;
            }
        };

        template <>
        struct allocator_spec<const char>: public allocator_iface
        {
            inline allocator_spec()
            {
                clone       = char_clone_func;
                free        = ::free;
            }
        };
    } /* namespace lltl */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_LLTL_SPEC_H_ */
