/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-lltl-lib
 * Created on: 17 авг. 2020 г.
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

#ifndef LSP_PLUG_IN_LLTL_ITERATOR_H_
#define LSP_PLUG_IN_LLTL_ITERATOR_H_

#include <lsp-plug.in/lltl/version.h>

#include <lsp-plug.in/common/variadic.h>
#include <lsp-plug.in/lltl/types.h>

namespace lsp
{
    namespace lltl
    {
        struct raw_iterator;

        struct LSP_LLTL_LIB_PUBLIC iter_cmp_result_t
        {
            ssize_t             res;
            bool                valid;
        };

        /**
         * Advance to next record in post-increment/pre-increment mode.
         * Post-increment mode should malloc() and return copy of iterator advanced to n steps.
         *
         * @param i pointer to the iterator
         * @param n number of steps to advance (can be negative)
         */
        typedef void (*iter_move_t)(raw_iterator *i, ssize_t n);

        /**
         * Get pointer to a value at which the iterator is currently pointing
         *
         * @param i pointer to the iterator
         * @return the actual value iterator is pointing to
         */
        typedef void *(*iter_get_t)(raw_iterator *i);

        /**
         * Compare positions of two iterators.
         *
         * @param a first iterator to compare
         * @param b second iterator to compare
         * @return comparison result
         */
        typedef ssize_t (*iter_compare_t)(const raw_iterator *a, const raw_iterator *b);

        /**
         * Compute difference in position between two iterators
         *
         * @param a first iterator to compare
         * @param b second iterator to compare
         * @return difference in position between two iterators
         */
        typedef ssize_t (*iter_diff_t)(const raw_iterator *a, const raw_iterator *b);

        /**
         * Obtain the overall number of elements in a collection the iterator is operating with
         *
         * @param i pointer to the iterator
         * @return number of elements in collection the iterator is operating with
         */
        typedef size_t (*iter_count_t)(const raw_iterator *i);

        /**
         * Virtual table of functions for the iterator
         */
        struct LSP_LLTL_LIB_PUBLIC iter_vtbl_t
        {
            iter_move_t         move;
            iter_get_t          get;
            iter_compare_t      cmp;
            iter_diff_t         diff;
            iter_count_t        count;
        };

        /**
         * Raw iterator interface with set of required functions
         */
        struct LSP_LLTL_LIB_PUBLIC raw_iterator
        {
            public:
                static const iter_vtbl_t invalid_vtbl; // Virtual table for invalid iterator
                static const raw_iterator INVALID;

            public:
                const iter_vtbl_t      *vtable;     // Virtual table, SHOULD NEVER be NULL, use invalid_vtbl for invalid iterators
                void                   *container;  // Pointer to container that holds data, SHOULD be NULL if iterator is invalid
                void                   *item;       // Pointer to current item
                size_t                  index;      // The overall index in the collection
                size_t                  offset;     // Some offset inside of data structure (may be not used)
                size_t                  part;       // Partition (may be not used)
                bool                    reversive;  // Reversive flag

            public:
                void                    advance(ssize_t n);
                iter_cmp_result_t       compare_to(const raw_iterator *b) const;
                bool                    valid() const;
                ssize_t                 diff(const raw_iterator *b) const;
                size_t                  remaining() const;
                size_t                  max_advance() const;
        };

        /**
         * Iterator class
         */
        template <class T>
        class iterator
        {
            public:
                static const iterator<T> INVALID;

            protected:
                mutable raw_iterator        v;

            private:
                inline static T *cast(void *ptr)                                { return reinterpret_cast<T *>(ptr);       }
                inline static const T *ccast(void *ptr)                         { return const_cast<const T *>(cast(ptr));  }

            public: // Construction/destruction
                explicit iterator()
                {
                    v   = raw_iterator::INVALID;
                }

                inline explicit iterator(const raw_iterator & begin)
                {
                    v   = begin;
                }

                inline explicit iterator(raw_iterator && begin)
                {
                    v   = lsp::move(begin);
                }

                iterator(const iterator<T> & src)
                {
                    v   = src.v;
                }

                iterator(iterator<T> && src)
                {
                    v   = lsp::move(src.v);
                }

                ~iterator()
                {
                    v   = raw_iterator::INVALID;
                }

            public: // Assignment
                /**
                 * Copy the state of provided the iterator
                 * @param src source iterator to copy the state
                 * @return reference to self
                 */
                inline iterator<T> & operator = (const iterator<T> & src)
                {
                    v   = src.v;
                    return *this;
                }

                /**
                 * Move the state of provided the iterator
                 * @param src source iterator to move the state
                 * @return reference to self
                 */
                inline iterator<T> & operator = (iterator<T> && src)
                {
                    v   = lsp::move(src.v);
                    return *this;
                }

            public: // Positioning
                /**
                 * Advance the iterator one element forward according to it's direction.
                 * Note that reaching the position after the end of collection makes the iterator invalid.
                 * @return reference to self ater position update
                 */
                inline iterator<T> & operator ++() { v.advance(1);  return *this; }

                /**
                 * Advance the iterator one element backward according to it's direction.
                 * Note that reaching the position before beginning of collection makes the iterator invalid.
                 * @return reference to self ater position update
                 */
                inline iterator<T> & operator --() { v.advance(-1); return *this; }

                /**
                 * Advance the iterator one element backward according to it's direction.
                 * Note that reaching the position before beginning of collection makes the iterator invalid.
                 * @return the iterator pointing to the position before update
                 */
                inline iterator<T> operator ++ (int)
                {
                    raw_iterator tmp = v;
                    v.advance(1);
                    return iterator<T>(lsp::move(tmp));
                }

                /**
                 * Advance the iterator one element backward according to it's direction.
                 * Note that reaching the position before beginning of collection makes the iterator invalid.
                 * @return the iterator pointing to the position before update
                 */
                inline iterator<T> operator -- (int)
                {
                    raw_iterator tmp = v;
                    v.advance(-1);
                    return iterator<T>(lsp::move(tmp));
                }

                /**
                 * Advance the iterator the specified number of elements forward according to it's direction.
                 * Note that reaching the position after the end of collection makes the iterator invalid.
                 * @param offset the number of elements to advance
                 * @return reference to self after position update
                 */
                inline iterator<T> operator += (ssize_t offset) { v.advance(offset);   return *this; }

                /**
                 * Advance the iterator the specified number of elements backward according to it's direction.
                 * Note that reaching the position before the beginning of collection makes the iterator invalid.
                 * @param offset the number of elements to advance
                 * @return reference to self after position update
                 */
                inline iterator<T> operator -= (ssize_t offset) { v.advance(-offset);  return *this; }

                /**
                 * Compute the new iterator advanced by the specified number of elements forward according to it's direction.
                 * Note that reaching the position after the end of collection makes the resulting iterator invalid.
                 * @param count the number of elements to advance
                 * @return reference to self after position update
                 */
                inline iterator<T> operator + (ssize_t count) const
                {
                    raw_iterator tmp = v;
                    v.advance(count);
                    return iterator<T>(lsp::move(tmp));
                }

                /**
                 * Compute the new iterator advanced by the specified number of elements backward according to it's direction.
                 * Note that reaching the position before the beginning of collection makes the resulting iterator invalid.
                 * @param count the number of elements to advance
                 * @return the new computed iterator
                 */
                inline iterator<T> operator - (ssize_t count) const
                {
                    raw_iterator tmp = v;
                    v.advance(-count);
                    return iterator<T>(lsp::move(tmp));
                }

                /**
                 * Compute the distance between two iterators. If iterators are siblings, then the result is the
                 * difference between their indices. If only one of the iterators is invalid, then the result is the
                 * return value of the remained() function call on the valid iterator from the pair.
                 * Otherwise the result is zero.
                 *
                 * @param it iterator to compute the difference
                 * @return difference between two iterators
                 */
                inline ssize_t operator - (const iterator<T> & it) const
                {
                    return v.diff(&it.v);
                }

            public: // Validation
                /**
                 * Check whether the iterator is valid
                 * @return true if iterator is valid
                 */
                inline operator bool() const    { return v.valid(); }

                /**
                 * Check whether the iterator is valid
                 * @return true if iterator is valid
                 */
                inline bool valid() const       { return v.valid(); }

                /**
                 * Check whether the iterator is invalid
                 * @return true if iterator is invalid
                 */
                inline bool operator !() const  { return !v.valid(); }

                /**
                 * Check whether the iterator is invalid
                 * @return true if iterator is invalid
                 */
                inline bool invalid() const     { return !v.valid(); }

                /**
                 * Check that iterator is operating on the same collection to the provided iterator
                 * @param it iterator to check
                 * @return true if both iterators operate on the same collection
                 */
                inline bool sibling_of(const iterator<T> *it) const { return v.container == it->v.container;   }

                /**
                 * Check that iterator is operating on the same collection to the provided iterator
                 * @param it iterator to check
                 * @return true if both iterators operate on the same collection
                 */
                inline bool sibling_of(const iterator<T> &it) const { return v.container == it.v.container;    }

                /**
                 * Check that iterator is operating on the same collection to the provided iterator
                 * @param it iterator to check
                 * @return true if both iterators operate on the same collection
                 */
                inline bool operator & (const iterator<T> *it) const { return sibling_of(it);       }

                /**
                 * Check that iterator is operating on the same collection to the provided iterator
                 * @param it iterator to check
                 * @return true if both iterators operate on the same collection
                 */
                inline bool operator & (const iterator<T> &it) const { return sibling_of(it);       }

                /**
                 * Check that iterator is operating on the different collection to the provided iterator
                 * @param it iterator to check
                 * @return true if iterators operate on different collections
                 */
                inline bool not_sibling_of(const iterator<T> *it) const { return v.container != it->v.container;   }

                /**
                 * Check that iterator is operating on the different collection to the provided iterator
                 * @param it iterator to check
                 * @return true if iterators operate on different collections
                 */
                inline bool not_sibling_of(const iterator<T> &it) const { return v.container != it.v.container;    }

                /**
                 * Check that iterator is operating on the different collection to the provided iterator
                 * @param it iterator to check
                 * @return true if iterators operate on different collections
                 */
                inline bool operator | (const iterator<T> *it) const { return not_sibling_of(it);   }

                /**
                 * Check that iterator is operating on the different collection to the provided iterator
                 * @param it iterator to check
                 * @return true if iterators operate on different collections
                 */
                inline bool operator | (const iterator<T> &it) const { return not_sibling_of(it);   }

            public: // Indexing
                /**
                 * Return some ordered number of the item
                 * @return ordered number of the item in range of [0 .. collection size - 1]
                 */
                inline size_t index() const     { return v.index; }

                /**
                 * Return number of items left (including current) to go before the iterator reaches the end of collection
                 * @return number of items
                 */
                inline size_t remaining() const { return v.remaining(); }

                /**
                 * Return number of steps left to go before the iterator reaches the end of collection
                 * @return number of steps
                 */
                inline size_t max_advance() const { return v.max_advance(); }

                /**
                 * Return the overall number of items in the collection
                 * @return overall number of items in the collection
                 */
                inline size_t count() const     { return v.vtable->count(&v); }

                /**
                 * Check that iterator has forward direction
                 * @return true if iterator has forward direction
                 */
                inline bool forward() const     { return !v.reversive; }

                /**
                 * Check that iterator has reversive (backward) direction
                 * @return true if iterator has backward direction
                 */
                inline bool reversive() const   { return v.reversive; }

            public: // Dereferencing, should be applied for valid iterators only
                /**
                 * Read the value the iterator is currently pointing to
                 * @return the value the iterator is currently pointing to
                 */
                inline T * operator *()
                {
                    T *tmp          = cast(v.vtable->get(&v));
                    return tmp;
                }

                /**
                 * Read the value the iterator is currently pointing to
                 * @return the value the iterator is currently pointing to
                 */
                inline const T * operator *() const
                {
                    const T *tmp    = ccast(v.vtable->get(&v));
                    return tmp;
                }

                /**
                 * Read the value the iterator is currently pointing to
                 * @return the value the iterator is currently pointing to
                 */
                inline T * operator ->()
                {
                    return cast(v.vtable->get(&v));
                }

                /**
                 * Read the value the iterator is currently pointing to
                 * @return the value the iterator is currently pointing to
                 */
                inline const T * operator ->() const
                {
                    return ccast(v.vtable->get(&v));
                }

                /**
                 * Read the value the iterator is currently pointing to
                 * @return the value the iterator is currently pointing to
                 */
                inline T * get()
                {
                    T *tmp          = cast(v.vtable->get(&v));
                    return tmp;
                }

                /**
                 * Read the value the iterator is currently pointing to
                 * @return the value the iterator is currently pointing to
                 */
                inline const T * get() const
                {
                    const T *tmp    = ccast(v.vtable->get(&v));
                    return tmp;
                }

            public:  // Comparison operators
                /**
                 * Compare two iterators. The result true if both iterators are siblings and
                 * the position of source iterator is less than the position of passed iterator
                 * respecive to the direction of the source iterator.
                 * @param it iterator to compare to.
                 * @return result of comparison
                 */
                inline bool operator < (const iterator<T> & it) const
                {
                    iter_cmp_result_t res = v.compare_to(&it.v);
                    return (res.valid) ? res.res < 0 : false;
                }

                /**
                 * Compare two iterators. The result true if both iterators are siblings and
                 * the position of source iterator is less or equal than the position of passed iterator
                 * respecive to the direction of the source iterator OR both iterators are invalid
                 * @param it iterator to compare to.
                 * @return result of comparison
                 */
                inline bool operator <= (const iterator<T> & it) const
                {
                    iter_cmp_result_t res = v.compare_to(&it.v);
                    return (res.valid) ? res.res <= 0 : false;
                }

                /**
                 * Compare two iterators. The result true if both iterators are siblings and
                 * the position of source iterator is equal to the position of passed iterator
                 * OR both iterators are invalid
                 * @param it iterator to compare to.
                 * @return result of comparison
                 */
                inline bool operator == (const iterator<T> & it) const
                {
                    iter_cmp_result_t res = v.compare_to(&it.v);
                    return (res.valid) ? res.res == 0 : false;
                }

                /**
                 * Compare two iterators. The result true if both iterators are siblings and
                 * the position of source iterator is not equal to the position of passed iterator
                 * OR only one of iterators is invalid
                 * @param it iterator to compare to.
                 * @return result of comparison
                 */
                inline bool operator != (const iterator<T> & it) const
                {
                    iter_cmp_result_t res = v.compare_to(&it.v);
                    return (res.valid) ? res.res != 0 : false;
                }

                /**
                 * Compare two iterators. The result true if both iterators are siblings and
                 * the position of source iterator is greater or equal than the position of passed iterator
                 * respecive to the direction of the source iterator OR both iterators are invalid
                 * @param it iterator to compare to.
                 * @return result of comparison
                 */
                inline bool operator >= (const iterator<T> & it) const
                {
                    iter_cmp_result_t res = v.compare_to(&it.v);
                    return (res.valid) ? res.res >= 0 : false;
                }

                /**
                 * Compare two iterators. The result true if both iterators are siblings and
                 * the position of source iterator is greater than the position of passed iterator
                 * respecive to the direction of the source iterator.
                 * @param it iterator to compare to.
                 * @return result of comparison
                 */
                inline bool operator > (const iterator<T> & it) const
                {
                    iter_cmp_result_t res = v.compare_to(&it.v);
                    return (res.valid) ? res.res > 0 : false;
                }

            public: // Swap operations
                /**
                 * Swap the internal state of two similar iterators
                 * @param it iterator to perform swap
                 */
                inline void swap(iterator<T> & it)
                {
                    lsp::swap(v, it.v);
                }

                /**
                 * Swap the internal state of two similar iterators
                 * @param it iterator to perform swap
                 */
                inline void swap(iterator<T> * it)
                {
                    lsp::swap(v, it->v);
                }
        };

        template <class T>
        const iterator<T> iterator<T>::INVALID = iterator<T>(raw_iterator::INVALID);

    } /* namespace lltl */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_LLTL_ITERATOR_H_ */
