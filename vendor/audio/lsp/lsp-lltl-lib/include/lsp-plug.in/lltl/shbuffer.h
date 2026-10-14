/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-lltl-lib
 * Created on: 18 янв. 2026 г.
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

#ifndef LSP_PLUG_IN_LLTL_SHBUFFER_H_
#define LSP_PLUG_IN_LLTL_SHBUFFER_H_

#include <lsp-plug.in/lltl/version.h>

#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/atomic.h>
#include <lsp-plug.in/common/status.h>

namespace lsp
{
    namespace lltl
    {
        /**
         * Raw shared buffer
         */
        struct LSP_LLTL_LIB_PUBLIC raw_shbuffer
        {
            public:
                typedef void    (* deleter_t)(void *data);

                typedef struct buffer_t
                {
                    uatomic_t       references;
                    deleter_t       deleter;
                    size_t          bytes;
                    uint8_t        *data;
                } buffer_t;

            public:
                buffer_t       *ptr;

            public:
                void           *get(size_t offset);
                void            map(void *data, size_t length, deleter_t deleter);
                void            make(const void *data, size_t length);
                buffer_t       *reference_up();
                void            reference_down(buffer_t *replace);
                ptrdiff_t       compare(const raw_shbuffer & src);
                ptrdiff_t       compare(const void *p);
        };

        /**
         * This class reperesents some reference to constant shared buffer
         * @tparam T type of data wrapped by shared buffer
         */
        template <typename T>
        class shbuffer
        {
            private:
                static constexpr size_t SZOF        = sizeof(T);

            private:
                mutable raw_shbuffer        v;

            private:
                inline static T    *cast(void *ptr) noexcept        { return static_cast<T *>(ptr);                 }
                inline static void *mkp(long v) noexcept            { return reinterpret_cast<void *>(v);           }

            public:
                typedef void        (* deleter_t)(T * data);

            public:
                /**
                 * Create empty shared buffer
                 */
                inline shbuffer()
                {
                    v.ptr       = NULL;
                }

                /**
                 * Create new reference to provided shared byffer
                 * @param src provided shared buffer
                 */
                inline shbuffer(const shbuffer & src)
                {
                    v.ptr       = src.v.reference_up();
                }

                /**
                 * Create new empty reference
                 */
                inline shbuffer(const nullptr_t)
                {
                    v.ptr       = NULL;
                }

                /**
                 * Move reference to provided shared buffer
                 * @param src provided shared buffer
                 */
                inline shbuffer(shbuffer && src)
                {
                    v.ptr       = src.v.ptr;
                    src.v.ptr   = NULL;
                }

                /**
                 * Create shared buffer associated with some already existing constant memory chunk
                 * @param data pointer to memory chunk
                 * @param count number of elements in chunk
                 * @param deleter memory deleter
                 */
                inline shbuffer(const T * data, size_t count, deleter_t deleter)
                {
                    v.ptr       = NULL;
                    v.map(const_cast<T *>(data), count * SZOF, reinterpret_cast<raw_shbuffer::deleter_t>(deleter));
                }

                /**
                 * Create shared buffer as a copy of memory chunk
                 * @param data pointer to memory chunk
                 * @param count number of elements in chunk
                 */
                inline shbuffer(const T * data, size_t count = 1)
                {
                    v.ptr       = NULL;
                    v.make(data, count * SZOF);
                }

                ~shbuffer()
                {
                    v.reference_down(NULL);
                }

            public: // Copy / move operations
                /**
                 * Make a copy reference
                 * @param src shource reference
                 * @return reference to self
                 */
                inline shbuffer & operator = (const shbuffer & src)
                {
                    v.reference_down(src.v.reference_up());
                    return *this;
                }

                /**
                 * Move a reference
                 * @param src shource reference
                 * @return reference to self
                 */
                inline shbuffer & operator = (shbuffer && src)
                {
                    v.ptr           = src.v.ptr;
                    src.v.ptr       = NULL;
                    return *this;
                }

                /**
                 * Assign NULL
                 * @param src shource reference
                 * @return reference to self
                 */
                inline shbuffer & operator = (const nullptr_t)
                {
                    v.reference_down(NULL);
                    return *this;
                }

            public: // Comparison
                inline ptrdiff_t compare(const void *ptr) const noexcept            { return v.compare(ptr);                }
                inline ptrdiff_t compare(ptrdiff_t ptr) const noexcept              { return v.compare(mkp(ptr));           }

                inline bool operator == (const shbuffer<T> & src) const noexcept    { return v.compare(src.v) == 0;         }
                inline bool operator != (const shbuffer<T> & src) const noexcept    { return v.compare(src.v) != 0;         }
                inline bool operator <  (const shbuffer<T> & src) const noexcept    { return v.compare(src.v) < 0;          }
                inline bool operator >  (const shbuffer<T> & src) const noexcept    { return v.compare(src.v) > 0;          }
                inline bool operator <= (const shbuffer<T> & src) const noexcept    { return v.compare(src.v) <= 0;         }
                inline bool operator >= (const shbuffer<T> & src) const noexcept    { return v.compare(src.v) >= 0;         }
                inline bool operator !  () const noexcept                           { return v.compare(NULL) == 0;          }
                inline operator bool() const noexcept                               { return v.compare(NULL) != 0;          }

            public:
                /**
                 * Obtain the value from the buffer
                 * @param index the index of the element
                 * @return pointer to the value or NULL if reference is null or index is outside of the buffer
                 */
                inline const T * get(size_t index = 0) const            { return cast(v.get(index * SZOF));     }
                inline const T * operator [] (size_t index) const       { return cast(v.get(index * SZOF));     }
                inline const T * operator * () const                    { return cast(v.get(0));                }
                inline const T * operator ->() const                    { return cast(v.get(0));                }

                /**
                 * Obtain the value from the buffer
                 * @param index the index of the element
                 * @return pointer to the value or NULL if reference is null or index is outside of the buffer
                 */
                inline T * get(size_t index = 0)                        { return cast(v.get(index * SZOF));     }
                inline T * operator [] (size_t index)                   { return cast(v.get(index * SZOF));     }
                inline T * operator * ()                                { return cast(v.get(0));                }
                inline T * operator ->()                                { return cast(v.get(0));                }

                /**
                 * Reset the reference
                 */
                inline shbuffer & reset()
                {
                    v.reference_down(NULL);
                    return *this;
                }

                /**
                 * Map shared buffer associated with some already existing memory chunk
                 * @param data pointer to memory chunk
                 * @param count number of elements in chunk
                 * @param deleter memory deleter
                 */
                inline shbuffer & map(const T * data, size_t count = 1, deleter_t deleter = NULL)
                {
                    v.map(const_cast<T *>(data), count * SZOF, reinterpret_cast<raw_shbuffer::deleter_t>(deleter));
                    return *this;
                }

                /**
                 * Set shared buffer as a copy of memory chunk
                 * @param data pointer to memory chunk
                 * @param count number of elements in chunk
                 */
                inline shbuffer & set(const T * data, size_t count = 1)
                {
                    v.make(data, count * SZOF);
                    return *this;
                }

                /**
                 * Get overall number of bytes used by buffer
                 * @return number of bytes used by buffer
                 */
                inline size_t bytes() const                             { return (v.ptr != NULL) ? v.ptr->bytes : 0;            }

                /**
                 * Get overall number of elements used by buffer
                 * @return number of elements used by buffer
                 */
                inline size_t count() const                             { return (v.ptr != NULL) ? v.ptr->bytes/SZOF : 0;       }

                /**
                 * Get number of references
                 * @return number of references
                 */
                inline size_t references() const                        { return (v.ptr != NULL) ? atomic_load(&v.ptr->references) : 0;     }

            public:
                inline void swap(shbuffer<T> * src)                     { lsp::swap(v.ptr, src->v.ptr);                         }
                inline void swap(shbuffer<T> & src)                     { lsp::swap(v.ptr, src.v.ptr);                          }
        };

        template<typename V>
        inline bool operator == (const shbuffer<V> & ptr, nullptr_t) noexcept
        {
            return bool(ptr);
        }

        template<typename V>
        inline bool operator == (nullptr_t, const shbuffer<V> & ptr) noexcept
        {
            return bool(ptr);
        }

        template<typename V>
        inline bool operator != (const shbuffer<V> & ptr, nullptr_t) noexcept
        {
            return !ptr;
        }

        template<typename V>
        inline bool operator != (nullptr_t, const shbuffer<V> & ptr) noexcept
        {
            return !ptr;
        }

    #define LLTL_SHBUFFER_DEF_INT_OP(op_def, type) \
        template<typename V> \
        inline bool operator op_def (const shbuffer<V> & ptr, type xptr) noexcept \
        { \
            return ptr.compare(ptrdiff_t(xptr)) op_def 0; \
        } \
        \
        template<typename V> \
        inline bool operator op_def (type xptr, const shbuffer<V> & ptr) noexcept \
        { \
            return 0 op_def ptr.compare(ptrdiff_t(xptr)); \
        } \

    #define LLTL_SHBUFFER_DEF_PTR_OP(op_def) \
        template<typename V, typename P> \
        inline bool operator op_def (const shbuffer<V> & ptr, const P *xptr) noexcept \
        { \
            return ptr.compare(xptr) op_def 0; \
        } \
        \
        template<typename P, typename V> \
        inline bool operator op_def (const P *xptr, const shbuffer<V> & ptr) noexcept \
        { \
            return 0 op_def ptr.compare(xptr); \
        }

    #define LLTL_SHBUFFER_DEF_OP(op_def) \
        /* Definitions for integer constants */ \
        LLTL_SHBUFFER_DEF_INT_OP(op_def, int) \
        LLTL_SHBUFFER_DEF_INT_OP(op_def, long) \
        LLTL_SHBUFFER_DEF_INT_OP(op_def, long long) \
        /* Definitions for any pointer type */ \
        LLTL_SHBUFFER_DEF_PTR_OP(op_def)

        LLTL_SHBUFFER_DEF_OP(==)
        LLTL_SHBUFFER_DEF_OP(!=)
        LLTL_SHBUFFER_DEF_OP(<=)
        LLTL_SHBUFFER_DEF_OP(>=)
        LLTL_SHBUFFER_DEF_OP(<)
        LLTL_SHBUFFER_DEF_OP(>)

    #undef LLTL_SHBUFFER_DEF_OP
    #undef LLTL_SHBUFFER_DEF_INT_OP
    #undef LLTL_SHBUFFER_DEF_PTR_OP
    } /* namespace lltl */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_LLTL_SHBUFFER_H_ */
