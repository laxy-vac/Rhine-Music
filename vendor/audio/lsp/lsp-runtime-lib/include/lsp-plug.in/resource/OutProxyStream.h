/*
 * Copyright (C) 2021 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2021 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 20 мар. 2021 г.
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

#ifndef LSP_PLUG_IN_RESOURCE_OUTPROXYSTREAM_H_
#define LSP_PLUG_IN_RESOURCE_OUTPROXYSTREAM_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/io/IOutStream.h>

namespace lsp
{
    namespace resource
    {
        class OutProxyStream: public io::IOutStream
        {
            private:
                OutProxyStream & operator = (const OutProxyStream &);
                OutProxyStream(const OutProxyStream &);

            protected:
                io::IOutStream *pOS;
                wssize_t        nPosition;
                size_t          nWrapFlags;

            public:
                explicit OutProxyStream();
                virtual ~OutProxyStream();

            protected:
                status_t            do_close();

            public:
                status_t            wrap(io::IOutStream *os, size_t flags);

            public:
                virtual wssize_t    position();

                virtual ssize_t     write(const void *buf, size_t count);

                virtual wssize_t    seek(wsize_t position);

                virtual status_t    flush();

                virtual status_t    close();
        };
    }
}

#endif /* LSP_PLUG_IN_RESOURCE_OUTPROXYSTREAM_H_ */
