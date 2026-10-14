/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-lltl-lib
 * Created on: 10 мая 2020 г.
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

#ifndef LSP_PLUG_IN_LLTL_TYPES_H_
#define LSP_PLUG_IN_LLTL_TYPES_H_

#include <lsp-plug.in/lltl/version.h>
#include <lsp-plug.in/common/types.h>

#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <sys/types.h>

namespace lsp
{
    namespace lltl
    {
        /**
         * Hashing function
         *
         * @param ptr pointer to the object to retrieve hash value, never NULL
         * @param size size of the object in bytes
         * @return hash value
         */
        typedef     size_t (* hash_func_t)(const void *ptr, size_t size);

        /**
         * Comparison function
         * @param a pointer to object a, never NULL
         * @param b pointer to object b, never NULL
         * @param size size of type for objects a and b
         * @return negative value if a less than b, positive if a is greater than b, 0 otherwise
         */
        typedef     ssize_t (* compare_func_t)(const void *a, const void *b, size_t size);

        /**
         * Copy function with dynamic memory allocation
         * @param src source object to copy, never NULL
         * @param size size of the object
         * @return pointer to copied object
         */
        typedef     void *(* clone_func_t)(const void *src, size_t size);

        /**
         * Resource destruction and freeing function
         *
         * @param ptr pointer to the data, never NULL
         */
        typedef     void (* free_func_t)(void *ptr);

        /**
         * Initialization function
         * @param dst destination object to initialize
         * @param size size of object
         */
        typedef     void *(* init_func_t)(void *dst, size_t size);

        /**
         * Finalization function
         * @param dst destination object to finalize
         * @param size size of object
         */
        typedef     void  (* fini_func_t)(void *dst, size_t size);

        /**
         * Copying function with statically allocated memory
         * @param dst destination object to perform copy
         * @param src source object
         * @param size size of object
         */
        typedef     void  (* copy_func_t)(void *dst, const void *src, size_t size);

        /**
         * Default comparison function, performs byte-precise comparison of one
         * memory block to another memory block. Note that the result depends on
         * the byte order, so the function is safe to use for equal comparison.
         *
         * @param a pointer to first memory block
         * @param b pointer to second memory block
         * @param size size of each block in bytes
         * @return comparison result:
         *    - negative if a < b
         *    - positive if a > b
         *    - zero if a == 0
         */
        LSP_LLTL_LIB_PUBLIC
        ssize_t     default_compare_func(const void *a, const void *b, size_t size);

        /**
         * Default hashing function
         *
         * @param ptr pointer to the object to retrieve hash value
         * @param size size of the object in bytes
         * @return hash value
         */
        LSP_LLTL_LIB_PUBLIC
        size_t      default_hash_func(const void *ptr, size_t size);

        /**
         * Default hashing function for raw pointers (considering pointer
         * being uniquely identifying object)
         *
         * @param ptr pointer to the object to compute the hash value
         * @param size size of the object in bytes (not used)
         * @return hash value
         */
        LSP_LLTL_LIB_PUBLIC
        size_t      ptr_hash_func(const void *ptr, size_t size);

        /**
         * Hash function for computing C string hash
         * @param ptr pointer to the C string
         * @param size size of char type
         * @return hash function
         */
        LSP_LLTL_LIB_PUBLIC
        size_t      char_hash_func(const void *ptr, size_t size);

        /**
         * Comparison function for comparing C strings
         * @param a C string a
         * @param b C string b
         * @param size size of char type
         * @return comparison result
         */
        LSP_LLTL_LIB_PUBLIC
        ssize_t     char_cmp_func(const void *a, const void *b, size_t size);

        /**
         * Comparison function for raw pointers (considering pointer
         * being uniquely identifying object)
         * @param a pointer a
         * @param b pointer b
         * @param size size of object, not used
         * @return comparison result
         */
        LSP_LLTL_LIB_PUBLIC
        ssize_t     ptr_cmp_func(const void *a, const void *b, size_t size);

        /**
         * Copying character data (C string)
         * @param ptr pointer to character string
         * @param size size of char type
         * @return pointer to allocated C string
         */
        LSP_LLTL_LIB_PUBLIC
        void       *char_clone_func(const void *ptr, size_t size);

        /**
         * Hash interface: function to perform hashing of the non-NULL object
         */
        struct hash_iface
        {
            hash_func_t         hash;       // Hashing function
        };

        /**
         * Compare interface: function to perform comparison of non-NULL objects
         */
        struct compare_iface
        {
            compare_func_t      compare;    // Comparison function
        };

        /**
         * Allocator interface: functions to perform copying and destruction of dynamic objects
         */
        struct allocator_iface
        {
            clone_func_t        clone;      // Copy function
            free_func_t         free;       // Free function
        };

        /**
         * Interface for in-place stored objects
         */
        struct initializer_iface
        {
            init_func_t         init;       // Initialization function
            fini_func_t         fini;       // Finalization function
            copy_func_t         copy;       // Copy function
        };

        /**
         * Interface for sorting
         */
        struct sort_closure_t
        {
            size_t          size;
            compare_func_t  compare;
        };

        /**
         * Raw pair definition
         */
        struct raw_pair_t
        {
            void           *key;
            void           *value;
        };

        /**
         * Pair definition
         */
        template <class K, class V>
        struct pair
        {
            const K * const key;
            V              *value;
        };

    } /* namespace lltl */
} /* namespace lsp */

// Include default specialization
#include <lsp-plug.in/lltl/spec.h>

#endif /* LSP_PLUG_IN_LLTL_TYPES_H_ */
