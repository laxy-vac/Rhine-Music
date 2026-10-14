/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 21 февр. 2023 г.
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

#ifndef LSP_PLUG_IN_IO_INSHAREDMEMORYSTREAM_H_
#define LSP_PLUG_IN_IO_INSHAREDMEMORYSTREAM_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/io/IInStream.h>
#include <lsp-plug.in/io/OutMemoryStream.h>

namespace lsp
{
    namespace io
    {
        /**
         * Input memory stream with shared memory chunk among all owners.
         * The read position is individual for each owner.
         */
        class InSharedMemoryStream: public IInStream
        {
            protected:
                typedef struct shared_data_t
                {
                    uint8_t        *pData;
                    size_t          nSize;
                    mutable size_t  nRefs;
                    lsp_memdrop_t   enDrop;
                } shared_data_t;

            protected:
                size_t          nOffset;
                shared_data_t  *pShared;

            protected:
                void release_shared();

            public:
                explicit InSharedMemoryStream();

                /** Copy constructor, the current read position becomes the same to the origin
                 * @param src source stream to copy
                 */
                InSharedMemoryStream(const InSharedMemoryStream & src);
                explicit InSharedMemoryStream(const InSharedMemoryStream * src);

                /** Move constructor, the current read position becomes the same to the origin
                 * @param src source stream to copy
                 */
                InSharedMemoryStream(InSharedMemoryStream && src);

                /**
                 * Create memory input stream
                 * @param data associated buffer
                 * @param size size of buffer
                 */
                explicit InSharedMemoryStream(const void *data, size_t size);

                /**
                 * Create memory input stream
                 * @param data associated buffer
                 * @param size size of buffer
                 * @param drop the method how to drop data on close()
                 */
                explicit InSharedMemoryStream(void *data, size_t size, lsp_memdrop_t drop);

                InSharedMemoryStream & operator = (const InSharedMemoryStream &);
                InSharedMemoryStream & operator = (InSharedMemoryStream &&);

                virtual ~InSharedMemoryStream() override;

            public:
                /**
                 * Wrap the memory buffer, drop previous buffer using specified mechanism
                 * @param data associated buffer
                 * @param size size of buffer
                 * @param drop the method how to drop data on close()
                 */
                status_t            wrap(void *data, size_t size, lsp_memdrop_t drop);

                /**
                 * Wrap the memory buffer, drop previous buffer using specified mechanism
                 * @param data associated buffer
                 * @param size size of buffer
                 */
                status_t            wrap(const void *data, size_t size);

                /**
                 * Wrap the data contained inside of another shared memory stream
                 * @param src source stream to wrap
                 */
                void                wrap(const InSharedMemoryStream &src);
                void                wrap(const InSharedMemoryStream *src);

                /**
                 * Wrap the data contained inside of another shared memory stream
                 * @param src source stream to wrap
                 * @param offset initial read offset
                 */
                void                wrap(const InSharedMemoryStream &src, wsize_t offset);
                void                wrap(const InSharedMemoryStream *src, wsize_t offset);

                /**
                 * Get the memory contents
                 * @return memory contents
                 */
                inline const uint8_t *data() const { return (pShared != NULL) ? pShared->pData : NULL; }

                /**
                 * Obtain the size of memory buffer wrapped by the memory stream
                 * @return the size of memory buffer in bytes
                 */
                inline size_t       size() const { return (pShared != NULL) ? pShared->nSize : 0;   }

                /**
                 * Obtain the overall reference count to the wrapped data
                 * @return overall reference count to the wrapped data
                 */
                inline size_t       references() const { return (pShared != NULL) ? pShared->nRefs : 0; }

                /**
                 * Swap contents
                 * @param src the shared memory stream to perform swap
                 */
                void                swap(InSharedMemoryStream &src);
                void                swap(InSharedMemoryStream *src);

                void                take(InSharedMemoryStream &src);
                void                take(InSharedMemoryStream *src);

                status_t            take(OutMemoryStream &src);
                status_t            take(OutMemoryStream *src);

            public: // IInStream
                virtual wssize_t    avail() override;
                virtual wssize_t    position() override;
                virtual ssize_t     read(void *dst, size_t count) override;
                virtual ssize_t     read_byte() override;
                virtual wssize_t    seek(wsize_t position) override;
                virtual wssize_t    skip(wsize_t amount) override;
                virtual status_t    close() override;
        };

    } /* namespace io */
} /* namespace lsp */


#endif /* LSP_PLUG_IN_IO_INSHAREDMEMORYSTREAM_H_ */
